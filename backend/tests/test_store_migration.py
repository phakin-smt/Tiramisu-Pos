"""The store migration has to leave an existing shop's data exactly as it was.

Every case here starts from fixtures/legacy_schema.sql -- a verbatim copy of the
schema production is running today -- fills it with representative rows, and
then lets init_schema() migrate it, which is the same path a real deployment
takes on its first start after the upgrade.
"""

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault('POS_PIN', '2468')
os.environ.setdefault('SECRET_KEY', 'test-only-secret-key')
# Importing server runs init_schema() immediately; point it somewhere disposable
# so this module never touches the developer's local pos.db.
_import_db = tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False)
_import_db.close()
os.environ['SQLITE_PATH'] = _import_db.name

import database  # noqa: E402
import server  # noqa: E402


LEGACY_SCHEMA = (Path(__file__).resolve().parent / 'fixtures' / 'legacy_schema.sql').read_text(encoding='utf-8')


class StoreMigrationTests(unittest.TestCase):
    def setUp(self):
        handle = tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False)
        handle.close()
        self.db_path = Path(handle.name)
        self.original_sqlite_path = database.SQLITE_PATH
        database.SQLITE_PATH = self.db_path
        self._seed_legacy_database()

    def tearDown(self):
        database.SQLITE_PATH = self.original_sqlite_path
        self.db_path.unlink(missing_ok=True)

    def _seed_legacy_database(self):
        connection = sqlite3.connect(self.db_path)
        try:
            connection.executescript(LEGACY_SCHEMA)
            connection.executescript("""
                INSERT INTO customers (id, customer_code, full_name, customer_type)
                VALUES (1, 'CUST-0001', 'Walk-in', 'walkin');
                INSERT INTO products (id, sku, name, category, unit_price, cost_price, stock_qty, stock_min)
                VALUES (1, 'M001', 'Teramisu OG', 'Tiramisu', 69, 19.12, 7, 2),
                       (2, 'M014', 'Burnt Cheesecake', 'Cheesecake', 60, 15.94, 12, 2);
                INSERT INTO orders (id, order_number, idempotency_key, order_date, customer_id,
                                    payment_method, subtotal, discount, total)
                VALUES (1, '202608181230', 'key-one', '2026-08-18', 1, 'cash', 138, 0, 138),
                       (2, '202608181245', 'key-two', '2026-08-18', 1, 'transfer', 69, 7, 62);
                INSERT INTO order_items (order_id, product_id, product_name, sku, quantity, unit_price, line_total)
                VALUES (1, 1, 'Teramisu OG', 'M001', 2, 69, 138),
                       (2, 1, 'Teramisu OG', 'M001', 1, 69, 69);
                INSERT INTO payments (order_id, payment_method, paid_amount)
                VALUES (1, 'cash', 138), (2, 'transfer', 62);
                INSERT INTO stock_movements (product_id, movement_type, quantity, reference_type, reference_id)
                VALUES (1, 'sale', -2, 'order', '202608181230'),
                       (1, 'stock_in', 10, 'daily_prep', NULL);
                INSERT INTO stock_plans (product_id, plan_date, quantity, status)
                VALUES (2, '2026-08-20', 5, 'pending');
                INSERT INTO daily_closures (report_date, closed_at)
                VALUES ('2026-08-18', '2026-08-18 15:00:00');
                INSERT INTO cash_days (report_date, opening_float)
                VALUES ('2026-08-18', 1500);
            """)
            connection.commit()
        finally:
            connection.close()

    def query(self, sql, params=()):
        connection = database.connect_db()
        try:
            return connection.execute(sql, params).fetchall()
        finally:
            connection.close()

    def test_migration_preserves_every_row(self):
        before = {table: self.query('SELECT COUNT(*) FROM ' + table)[0][0]
                  for table in ('products', 'orders', 'order_items', 'payments',
                                'stock_movements', 'stock_plans', 'daily_closures', 'cash_days')}
        database.init_schema()
        after = {table: self.query('SELECT COUNT(*) FROM ' + table)[0][0] for table in before}
        self.assertEqual(before, after)

    def test_existing_rows_land_in_the_first_store(self):
        database.init_schema()
        for table in ('products', 'orders', 'stock_movements', 'stock_plans',
                      'daily_closures', 'cash_days'):
            rows = self.query('SELECT COUNT(*) FROM {} WHERE store_id = 1'.format(table))[0][0]
            total = self.query('SELECT COUNT(*) FROM ' + table)[0][0]
            self.assertEqual(rows, total, '{} did not move into store 1'.format(table))

    def test_default_store_is_created_once(self):
        database.init_schema()
        database.init_schema()
        stores = self.query('SELECT id, code FROM stores')
        self.assertEqual([(1, 'baannoi')], [(row['id'], row['code']) for row in stores])

    def test_order_and_product_values_survive_untouched(self):
        database.init_schema()
        order = self.query("SELECT * FROM orders WHERE order_number = '202608181245'")[0]
        self.assertEqual('key-two', order['idempotency_key'])
        self.assertEqual('transfer', order['payment_method'])
        self.assertEqual(7, order['discount'])
        self.assertEqual(62, order['total'])
        product = self.query("SELECT * FROM products WHERE sku = 'M001'")[0]
        self.assertEqual('Teramisu OG', product['name'])
        self.assertEqual(7, product['stock_qty'])
        self.assertEqual(69, product['unit_price'])

    def test_foreign_keys_still_resolve_after_the_rebuild(self):
        database.init_schema()
        self.assertEqual([], self.query('PRAGMA foreign_key_check'))
        joined = self.query(
            'SELECT o.order_number, p.sku FROM order_items oi '
            'JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id '
            'ORDER BY oi.id'
        )
        self.assertEqual([('202608181230', 'M001'), ('202608181245', 'M001')],
                         [(row['order_number'], row['sku']) for row in joined])

    def test_sku_is_unique_per_store_rather_than_globally(self):
        database.init_schema()
        connection = database.connect_db()
        try:
            connection.execute("INSERT INTO stores (id, code, name) VALUES (2, 'pasta', 'Pasta')")
            # The same SKU in another store is now allowed...
            connection.execute(
                "INSERT INTO products (store_id, sku, name, category, unit_price) "
                "VALUES (2, 'M001', 'Carbonara', 'Pasta', 180)"
            )
            connection.commit()
            # ...while a duplicate inside one store is still refused.
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "INSERT INTO products (store_id, sku, name, category, unit_price) "
                    "VALUES (2, 'M001', 'Another', 'Pasta', 200)"
                )
        finally:
            connection.close()

    def test_each_store_closes_and_floats_its_own_day(self):
        database.init_schema()
        connection = database.connect_db()
        try:
            connection.execute("INSERT INTO stores (id, code, name) VALUES (2, 'pasta', 'Pasta')")
            # The same business date for a second store used to collide on the
            # primary key; both shops now keep their own row.
            connection.execute("INSERT INTO daily_closures (store_id, report_date) VALUES (2, '2026-08-18')")
            connection.execute("INSERT INTO cash_days (store_id, report_date, opening_float) VALUES (2, '2026-08-18', 800)")
            connection.commit()
            self.assertEqual(2, connection.execute(
                "SELECT COUNT(*) FROM daily_closures WHERE report_date = '2026-08-18'").fetchone()[0])
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute("INSERT INTO daily_closures (store_id, report_date) VALUES (2, '2026-08-18')")
        finally:
            connection.close()

    def test_running_the_migration_twice_changes_nothing(self):
        database.init_schema()
        first = self.query('SELECT id, store_id, sku, stock_qty FROM products ORDER BY id')
        database.init_schema()
        second = self.query('SELECT id, store_id, sku, stock_qty FROM products ORDER BY id')
        self.assertEqual([tuple(row) for row in first], [tuple(row) for row in second])

    def test_the_application_serves_migrated_data(self):
        database.init_schema()
        client = server.app.test_client()
        client.post('/api/auth/login', json={'pin': '2468'})
        response = client.get('/api/products')
        self.assertEqual(200, response.status_code)
        self.assertEqual({'M001', 'M014'}, {item['code'] for item in response.get_json()})


if __name__ == '__main__':
    unittest.main()
