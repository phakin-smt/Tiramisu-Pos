import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault('POS_PIN', '2468')
os.environ.setdefault('SECRET_KEY', 'test-only-secret-key')

import database
import server


class ProductAdminTests(unittest.TestCase):
    def setUp(self):
        handle = tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False)
        handle.close()
        self.db_path = Path(handle.name)
        self.original_sqlite_path = database.SQLITE_PATH
        database.SQLITE_PATH = self.db_path
        database.init_schema()
        self.client = server.app.test_client()
        self.client.post('/api/auth/login', json={'pin': '2468'})
        self.product_id = self.client.post('/api/products', json=self.form(stock=10)).get_json()['id']

    def tearDown(self):
        database.SQLITE_PATH = self.original_sqlite_path
        self.db_path.unlink(missing_ok=True)

    def form(self, **overrides):
        values = {'code': 'CAKE', 'name': 'Cake', 'category': 'Tiramisu', 'price': 69, 'cost': 20, 'stock': 0, 'minStock': 2}
        values.update(overrides)
        return values

    def value(self, query, params=()):
        connection = database.connect_db()
        try:
            row = connection.execute(query, params).fetchone()
            return row[0] if row else None
        finally:
            connection.close()

    def stock(self):
        return self.value('SELECT stock_qty FROM products WHERE id=?', (self.product_id,))

    def sell(self, qty, key):
        response = self.client.post('/api/orders', headers={'Idempotency-Key': key}, json={'items': [{'productId': self.product_id, 'qty': qty}], 'paymentMethod': 'cash', 'customerType': 'walkin', 'discount': 0})
        self.assertEqual(response.status_code, 200, response.get_json())

    def test_a_new_menu_starts_with_the_stock_it_was_given(self):
        self.assertEqual(self.stock(), 10)

    def test_editing_a_menu_does_not_undo_a_sale_made_while_the_form_was_open(self):
        self.sell(3, 'sale-while-editing')
        # The form still holds the 10 it read when it opened.
        response = self.client.put(f'/api/products/{self.product_id}', json=self.form(price=75, stock=10))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.stock(), 7)
        self.assertEqual(self.value('SELECT unit_price FROM products WHERE id=?', (self.product_id,)), 75)

    def test_editing_a_menu_never_changes_stock_without_a_movement(self):
        self.client.put(f'/api/products/{self.product_id}', json=self.form(stock=99))
        self.assertEqual(self.stock(), 10)
        self.assertEqual(self.value('SELECT COUNT(*) FROM stock_movements WHERE product_id=?', (self.product_id,)), 0)

    def test_an_unused_menu_is_really_deleted(self):
        response = self.client.delete(f'/api/products/{self.product_id}')
        self.assertEqual(response.get_json(), {'id': self.product_id, 'deleted': True, 'deactivated': False})
        self.assertIsNone(self.value('SELECT id FROM products WHERE id=?', (self.product_id,)))

    def test_a_sold_menu_is_taken_off_sale_and_says_so(self):
        self.sell(1, 'sold-once')
        response = self.client.delete(f'/api/products/{self.product_id}')
        self.assertEqual(response.get_json(), {'id': self.product_id, 'deleted': False, 'deactivated': True})
        self.assertEqual(self.value('SELECT is_active FROM products WHERE id=?', (self.product_id,)), 0)

    def test_a_menu_prepared_but_never_sold_is_taken_off_sale_instead_of_failing(self):
        adjusted = self.client.post('/api/stock/adjust', json={'productId': self.product_id, 'reason': 'prepare', 'quantity': 5})
        self.assertEqual(adjusted.status_code, 200)
        response = self.client.delete(f'/api/products/{self.product_id}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['deactivated'], True)
        self.assertEqual(self.value('SELECT COUNT(*) FROM stock_movements WHERE product_id=?', (self.product_id,)), 1)


if __name__ == '__main__':
    unittest.main()
