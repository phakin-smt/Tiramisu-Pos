"""Two stores sharing one deployment must never see each other's data.

Each case sets up a second store alongside the migrated first one and checks
that the boundary holds from the outside, through the API, rather than by
inspecting queries.
"""

import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault('POS_PIN', '2468')
os.environ.setdefault('SECRET_KEY', 'test-only-secret-key')
_import_db = tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False)
_import_db.close()
os.environ.setdefault('SQLITE_PATH', _import_db.name)

import database  # noqa: E402
import server  # noqa: E402


class StoreScopingTests(unittest.TestCase):
    def setUp(self):
        handle = tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False)
        handle.close()
        self.db_path = Path(handle.name)
        self.original_sqlite_path = database.SQLITE_PATH
        database.SQLITE_PATH = self.db_path
        database.init_schema()
        self.seed()
        self.client = server.app.test_client()
        self.client.post('/api/auth/login', json={'pin': '2468'})

    def tearDown(self):
        database.SQLITE_PATH = self.original_sqlite_path
        self.db_path.unlink(missing_ok=True)

    def seed(self):
        connection = database.connect_db()
        try:
            connection.execute("INSERT INTO stores (id, code, name) VALUES (2, 'pasta', 'Pasta')")
            connection.execute("INSERT INTO customers (customer_code, full_name, customer_type)"
                               " VALUES ('CUST-0001', 'Walk-in', 'walkin')")
            # The same SKU on both sides, to prove the boundary is the store and
            # not something incidental like a unique code.
            connection.execute("INSERT INTO products (store_id, sku, name, category, unit_price, cost_price, stock_qty)"
                               " VALUES (1, 'A01', 'Teramisu OG', 'Tiramisu', 69, 20, 10)")
            connection.execute("INSERT INTO products (store_id, sku, name, category, unit_price, cost_price, stock_qty)"
                               " VALUES (2, 'A01', 'Carbonara', 'Pasta', 180, 60, 10)")
            connection.commit()
        finally:
            connection.close()

    def use(self, store_id):
        response = self.client.post('/api/auth/select-store', json={'storeId': store_id})
        self.assertEqual(200, response.status_code)

    def product_id(self, store_id, sku):
        connection = database.connect_db()
        try:
            return connection.execute('SELECT id FROM products WHERE store_id=? AND sku=?',
                                      (store_id, sku)).fetchone()[0]
        finally:
            connection.close()

    def sell(self, product_id, key, qty=1):
        return self.client.post('/api/orders',
                                json={'items': [{'productId': product_id, 'qty': qty, 'giveawayQty': 0}],
                                      'paymentMethod': 'cash'},
                                headers={'Idempotency-Key': key})

    # --- selection ---------------------------------------------------------

    def test_two_stores_make_the_choice_explicit(self):
        fresh = server.app.test_client()
        login = fresh.post('/api/auth/login', json={'pin': '2468'})
        self.assertIsNone(login.get_json()['storeId'])
        self.assertEqual(409, fresh.get('/api/products').status_code)
        fresh.post('/api/auth/select-store', json={'storeId': 2})
        self.assertEqual(200, fresh.get('/api/products').status_code)

    def test_an_unknown_store_is_refused(self):
        self.assertEqual(404, self.client.post('/api/auth/select-store', json={'storeId': 99}).status_code)

    # --- catalogue ---------------------------------------------------------

    def test_each_store_sees_only_its_own_menu(self):
        self.use(1)
        self.assertEqual(['Teramisu OG'], [p['name'] for p in self.client.get('/api/products').get_json()])
        self.use(2)
        self.assertEqual(['Carbonara'], [p['name'] for p in self.client.get('/api/products').get_json()])

    def test_categories_do_not_leak_between_stores(self):
        self.use(2)
        self.assertEqual(['Pasta'], self.client.get('/api/products/categories').get_json()['categories'])

    def test_a_product_of_another_store_cannot_be_edited(self):
        other = self.product_id(1, 'A01')
        self.use(2)
        edited = self.client.put('/api/products/{}'.format(other),
                                 json={'code': 'A01', 'name': 'Hijacked', 'category': 'Pasta', 'price': 1})
        self.assertEqual(404, edited.status_code)
        self.assertEqual(404, self.client.delete('/api/products/{}'.format(other)).status_code)

    # --- selling and reporting --------------------------------------------

    def test_a_sale_belongs_only_to_the_store_that_made_it(self):
        self.use(1)
        self.assertEqual(200, self.sell(self.product_id(1, 'A01'), 'key-store-1').status_code)

        self.use(2)
        self.assertEqual([], self.client.get('/api/orders').get_json()['orders'])
        self.assertEqual(0, self.client.get('/api/reports/daily-summary').get_json()['orderCount'])

        self.use(1)
        self.assertEqual(1, len(self.client.get('/api/orders').get_json()['orders']))
        self.assertEqual(1, self.client.get('/api/reports/daily-summary').get_json()['orderCount'])

    def test_stock_is_deducted_only_in_the_selling_store(self):
        self.use(1)
        self.sell(self.product_id(1, 'A01'), 'key-stock', qty=3)
        self.assertEqual(7, self.client.get('/api/products').get_json()[0]['stock'])
        self.use(2)
        self.assertEqual(10, self.client.get('/api/products').get_json()[0]['stock'])

    def test_another_store_cannot_cancel_the_order(self):
        self.use(1)
        self.sell(self.product_id(1, 'A01'), 'key-cancel')
        connection = database.connect_db()
        try:
            order_id = connection.execute('SELECT id FROM orders').fetchone()[0]
        finally:
            connection.close()
        self.use(2)
        self.assertEqual(404, self.client.post('/api/orders/{}/cancel'.format(order_id)).status_code)
        self.use(1)
        self.assertEqual(200, self.client.post('/api/orders/{}/cancel'.format(order_id)).status_code)

    def test_closing_one_store_leaves_the_other_open(self):
        self.use(1)
        self.assertEqual(200, self.client.post('/api/reports/close-day').status_code)
        self.use(2)
        days = self.client.get('/api/reports/days').get_json()['days']
        self.assertEqual([], [day for day in days if day['closedAt']])

    def test_opening_float_is_kept_per_store(self):
        self.use(1)
        self.client.put('/api/cash-day', json={'openingFloat': 1500})
        self.use(2)
        self.assertIsNone(self.client.get('/api/cash-day').get_json()['openingFloat'])
        self.client.put('/api/cash-day', json={'openingFloat': 800})
        self.assertEqual(800, self.client.get('/api/cash-day').get_json()['openingFloat'])
        self.use(1)
        self.assertEqual(1500, self.client.get('/api/cash-day').get_json()['openingFloat'])

    def test_stock_adjustments_stay_inside_the_store(self):
        other = self.product_id(1, 'A01')
        self.use(2)
        rejected = self.client.post('/api/stock/adjust',
                                    json={'productId': other, 'reason': 'prepare', 'quantity': 5})
        self.assertEqual(404, rejected.status_code)
        self.use(1)
        self.assertEqual(200, self.client.post('/api/stock/adjust',
                                               json={'productId': other, 'reason': 'prepare', 'quantity': 5}).status_code)

    def test_stock_summary_and_plans_are_separate(self):
        self.use(1)
        plan = self.client.post('/api/stock/plans',
                                json={'productId': self.product_id(1, 'A01'),
                                      'date': server.bangkok_today().isoformat(), 'quantity': 4})
        self.assertEqual(200, plan.status_code)
        self.use(2)
        self.assertEqual([], self.client.get('/api/stock/plans').get_json())
        summary = self.client.get('/api/stock/daily-summary').get_json()
        self.assertEqual(['Carbonara'], [item['name'] for item in summary['items']])


if __name__ == '__main__':
    unittest.main()
