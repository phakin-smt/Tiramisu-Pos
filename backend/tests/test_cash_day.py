import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault('POS_PIN', '2468')
os.environ.setdefault('SECRET_KEY', 'test-only-secret-key')

import database
import server


class CashDayApiTests(unittest.TestCase):
    def setUp(self):
        handle = tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False)
        handle.close()
        self.db_path = Path(handle.name)
        self.original_sqlite_path = database.SQLITE_PATH
        database.SQLITE_PATH = self.db_path
        database.init_schema()
        self.client = server.app.test_client()
        self.client.post('/api/auth/login', json={'pin': '2468'})

    def tearDown(self):
        database.SQLITE_PATH = self.original_sqlite_path
        self.db_path.unlink(missing_ok=True)

    def rows(self, query, params=()):
        connection = database.connect_db()
        try:
            return connection.execute(query, params).fetchall()
        finally:
            connection.close()

    def test_get_before_configured_returns_null(self):
        with patch.object(server, 'bangkok_today', return_value=date(2026, 8, 18)):
            response = self.client.get('/api/cash-day')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'date': '2026-08-18', 'openingFloat': None})

    def test_create_and_update_same_bangkok_date(self):
        with patch.object(server, 'bangkok_today', return_value=date(2026, 8, 18)):
            created = self.client.put('/api/cash-day', json={'openingFloat': 1260})
            updated = self.client.put('/api/cash-day', json={'openingFloat': 1500.5})
        self.assertEqual(created.get_json(), {'date': '2026-08-18', 'openingFloat': 1260.0})
        self.assertEqual(updated.get_json(), {'date': '2026-08-18', 'openingFloat': 1500.5})
        records = self.rows('SELECT report_date,opening_float FROM cash_days')
        self.assertEqual(len(records), 1)
        self.assertEqual(tuple(records[0]), ('2026-08-18', 1500.5))

    def test_zero_is_accepted(self):
        response = self.client.put('/api/cash-day', json={'openingFloat': 0})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['openingFloat'], 0.0)

    def test_negative_and_invalid_values_are_rejected(self):
        for value in (-1, 'not-money', None, True):
            with self.subTest(value=value):
                response = self.client.put('/api/cash-day', json={'openingFloat': value})
                self.assertEqual(response.status_code, 400)
        self.assertEqual(len(self.rows('SELECT report_date FROM cash_days')), 0)

    def test_opening_float_does_not_change_order_revenue(self):
        connection = database.connect_db()
        try:
            cursor = connection.execute("INSERT INTO products (sku,name,category,unit_price,cost_price,stock_qty,stock_min,is_active) VALUES ('P1','Cake','Tiramisu',100,20,5,0,1)")
            product_id = cursor.lastrowid
            connection.commit()
        finally:
            connection.close()
        self.client.put('/api/cash-day', json={'openingFloat': 1260})
        order = self.client.post('/api/orders', headers={'Idempotency-Key': 'cash-day-order'}, json={'items': [{'productId': product_id, 'qty': 1}], 'paymentMethod': 'cash', 'customerType': 'walkin', 'discount': 0})
        summary = self.client.get('/api/reports/daily-summary').get_json()
        close_day = self.client.get('/api/reports/close-day').get_json()
        self.assertEqual(order.get_json()['total'], 100)
        self.assertEqual(summary['cashTotal'], 100)
        self.assertEqual(summary['totalRevenue'], 100)
        self.assertEqual(close_day['openingFloat'], 1260)
        self.assertEqual(close_day['expectedCash'], 1360)


if __name__ == '__main__':
    unittest.main()
