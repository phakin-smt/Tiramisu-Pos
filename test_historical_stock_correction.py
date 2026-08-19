from datetime import timedelta

import server
from test_business_characterization import PosApiTestCase


class HistoricalStockCorrectionTests(PosApiTestCase):
    def correct(self, product_id, report_date, target, note='นับสต็อกตกหล่น'):
        return self.client.post('/api/stock/historical-correction', json={
            'productId': product_id, 'date': report_date, 'targetStock': target, 'note': note,
        })

    def test_historical_decrease_is_auditable_and_propagates_forward_only(self):
        product_id = self.add_product(stock=8)
        correction_date = (server.bangkok_today() - timedelta(days=2)).isoformat()
        previous_date = (server.bangkok_today() - timedelta(days=3)).isoformat()
        following_date = (server.bangkok_today() - timedelta(days=1)).isoformat()

        response = self.correct(product_id, correction_date, 5)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['delta'], -3)
        self.assertEqual(self.one('SELECT stock_qty FROM products WHERE id=?', (product_id,))[0], 5)
        movement = self.one("SELECT movement_type,reference_type,quantity,note,created_at FROM stock_movements")
        self.assertEqual(tuple(movement[:4]), ('adjust', 'correction', -3, 'นับสต็อกตกหล่น'))
        start, end = server.local_day_bounds(correction_date)
        self.assertGreaterEqual(str(movement['created_at']), str(start))
        self.assertLess(str(movement['created_at']), str(end))
        self.assertEqual(server.stock_data(previous_date)[0]['stockNow'], 8)
        corrected = server.stock_data(correction_date)[0]
        self.assertEqual(corrected['stockNow'], 5)
        self.assertEqual(server.stock_data(following_date)[0]['stockNow'], 5)
        self.assertEqual((corrected['prepared'], corrected['sold'], corrected['giveaway'], corrected['waste']), (0, 0, 0, 0))

    def test_historical_increase_updates_current_stock(self):
        product_id = self.add_product(stock=5)
        report_date = (server.bangkok_today() - timedelta(days=1)).isoformat()
        response = self.correct(product_id, report_date, 8)
        self.assertEqual(response.get_json()['delta'], 3)
        self.assertEqual(self.one('SELECT stock_qty FROM products WHERE id=?', (product_id,))[0], 8)

    def test_no_change_does_not_insert_a_movement(self):
        product_id = self.add_product(stock=5)
        response = self.correct(product_id, server.bangkok_today().isoformat(), 5)
        self.assertTrue(response.get_json()['noChange'])
        self.assertEqual(self.one('SELECT COUNT(*) FROM stock_movements')[0], 0)

    def test_rejects_negative_invalid_future_and_unknown_product(self):
        product_id = self.add_product(stock=5)
        today = server.bangkok_today().isoformat()
        future = (server.bangkok_today() + timedelta(days=1)).isoformat()
        self.assertEqual(self.correct(product_id, today, -1).status_code, 400)
        self.assertEqual(self.correct(product_id, future, 1).status_code, 400)
        self.assertEqual(self.client.post('/api/stock/historical-correction', json={'productId': product_id, 'date': 'bad', 'targetStock': 1}).status_code, 400)
        self.assertEqual(self.correct(99999, today, 1).status_code, 404)

    def test_rejects_when_later_consumption_would_make_current_stock_negative(self):
        product_id = self.add_product(stock=2)
        report_date = (server.bangkok_today() - timedelta(days=1)).isoformat()
        today_start, _ = server.local_day_bounds(server.bangkok_today().isoformat())
        self.execute("INSERT INTO stock_movements (product_id,movement_type,quantity,reference_type,created_at) VALUES (?,'sale',-3,'order',?)", (product_id, today_start))
        response = self.correct(product_id, report_date, 0)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.one('SELECT stock_qty FROM products WHERE id=?', (product_id,))[0], 2)
        self.assertEqual(self.one('SELECT COUNT(*) FROM stock_movements')[0], 1)
