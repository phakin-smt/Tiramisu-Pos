"""Replaying an offline sale must keep its own business date and never be rejected."""

import os
import tempfile
import unittest
from datetime import datetime, timedelta

_db_file = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
_db_file.close()
os.environ["SQLITE_PATH"] = _db_file.name
os.environ["POS_PIN"] = "2468"
os.environ["SECRET_KEY"] = "test-only-secret-key"

from database import connect_db, execute  # noqa: E402
from server import BANGKOK_TZ, STOCK_REVIEW_NOTE, app  # noqa: E402


def bangkok_today():
    return datetime.now(BANGKOK_TZ).date()


class OfflineOrderReplayTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        try:
            os.unlink(_db_file.name)
        except FileNotFoundError:
            pass

    def setUp(self):
        self.client = app.test_client()
        with self.client.session_transaction() as session:
            session["authenticated"] = True
        self.product_id = self.seed_product(stock=10)

    def seed_product(self, stock, sku=None):
        sku = sku or "REPLAY-{}".format(datetime.now().strftime("%H%M%S%f"))
        connection = connect_db()
        try:
            cursor = connection.cursor()
            execute(
                cursor,
                "INSERT INTO products (sku,name,category,unit_price,stock_qty,stock_min,is_active)"
                " VALUES (?,?,?,?,?,?,1)",
                (sku, "Replay " + sku, "Tiramisu", 69, stock, 0),
            )
            connection.commit()
            return cursor.lastrowid
        finally:
            connection.close()

    def stock_of(self, product_id):
        connection = connect_db()
        try:
            row = execute(
                connection.cursor(), "SELECT stock_qty FROM products WHERE id=?", (product_id,)
            ).fetchone()
            return row["stock_qty"]
        finally:
            connection.close()

    def order_row(self, order_number):
        connection = connect_db()
        try:
            return execute(
                connection.cursor(),
                "SELECT order_date,note,total FROM orders WHERE order_number=?",
                (order_number,),
            ).fetchone()
        finally:
            connection.close()

    def replay(self, key, business_date, created_at, items=None, product_id=None, **extra):
        payload = {
            "items": items or [{"productId": product_id or self.product_id, "qty": 2, "giveawayQty": 0}],
            "paymentMethod": "cash",
            "customerType": "walkin",
            "discount": 0,
            "offline": {"businessDate": business_date, "createdAt": created_at},
        }
        payload.update(extra)
        return self.client.post("/api/orders", json=payload, headers={"Idempotency-Key": key})

    def test_replayed_order_keeps_its_original_business_date(self):
        yesterday = bangkok_today() - timedelta(days=1)
        created = datetime.now(BANGKOK_TZ).replace(microsecond=0) - timedelta(days=1)

        response = self.replay("replay-date-1", yesterday.isoformat(), created.isoformat())

        self.assertEqual(response.status_code, 200)
        order_number = response.get_json()["orderNumber"]
        row = self.order_row(order_number)
        self.assertEqual(str(row["order_date"]), yesterday.isoformat())
        # The order number is derived from when the sale happened, not from sync time.
        self.assertTrue(order_number.startswith(created.strftime("%Y%m%d%H%M")))

    def test_online_order_still_uses_server_time(self):
        today = bangkok_today()
        response = self.client.post(
            "/api/orders",
            json={
                "items": [{"productId": self.product_id, "qty": 1, "giveawayQty": 0}],
                "paymentMethod": "cash",
                "customerType": "walkin",
                "discount": 0,
            },
            headers={"Idempotency-Key": "online-unchanged-1"},
        )
        self.assertEqual(response.status_code, 200)
        row = self.order_row(response.get_json()["orderNumber"])
        self.assertEqual(str(row["order_date"]), today.isoformat())
        self.assertIsNone(row["note"])
        self.assertFalse(response.get_json()["stockReview"])

    def test_replay_is_idempotent_and_does_not_deduct_twice(self):
        yesterday = (bangkok_today() - timedelta(days=1)).isoformat()
        created = (datetime.now(BANGKOK_TZ) - timedelta(days=1)).isoformat()
        before = self.stock_of(self.product_id)

        first = self.replay("replay-idem-1", yesterday, created)
        second = self.replay("replay-idem-1", yesterday, created)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.get_json()["duplicate"])
        self.assertEqual(second.get_json()["orderNumber"], first.get_json()["orderNumber"])
        self.assertEqual(self.stock_of(self.product_id), before - 2)

    def test_replay_records_the_sale_and_flags_it_when_stock_ran_out(self):
        product_id = self.seed_product(stock=1, sku="REPLAY-SHORT")
        yesterday = (bangkok_today() - timedelta(days=1)).isoformat()
        created = (datetime.now(BANGKOK_TZ) - timedelta(days=1)).isoformat()

        response = self.replay("replay-short-1", yesterday, created, product_id=product_id,
                               items=[{"productId": product_id, "qty": 3, "giveawayQty": 0}])

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["stockReview"])
        row = self.order_row(response.get_json()["orderNumber"])
        self.assertIn(STOCK_REVIEW_NOTE, row["note"])
        self.assertIn("ขาด 2", row["note"])
        # The money is still recorded, and stock floors at zero rather than
        # violating the CHECK (stock_qty >= 0) invariant.
        self.assertEqual(self.stock_of(product_id), 0)

    def test_online_order_is_still_rejected_when_stock_is_short(self):
        product_id = self.seed_product(stock=1, sku="ONLINE-SHORT")
        response = self.client.post(
            "/api/orders",
            json={
                "items": [{"productId": product_id, "qty": 5, "giveawayQty": 0}],
                "paymentMethod": "cash",
                "customerType": "walkin",
                "discount": 0,
            },
            headers={"Idempotency-Key": "online-short-1"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("คงเหลือไม่พอ", response.get_json()["error"])
        self.assertEqual(self.stock_of(product_id), 1)

    def test_replay_preserves_giveaway_split(self):
        product_id = self.seed_product(stock=10, sku="REPLAY-GIVEAWAY")
        yesterday = (bangkok_today() - timedelta(days=1)).isoformat()
        created = (datetime.now(BANGKOK_TZ) - timedelta(days=1)).isoformat()

        response = self.replay("replay-giveaway-1", yesterday, created, product_id=product_id,
                               items=[{"productId": product_id, "qty": 3, "giveawayQty": 1}])

        self.assertEqual(response.status_code, 200)
        # Two paid at 69, one given away, all three off the shelf.
        self.assertEqual(response.get_json()["total"], 138)
        self.assertEqual(self.stock_of(product_id), 7)

    def test_replay_rejects_a_malformed_or_future_offline_stamp(self):
        created = datetime.now(BANGKOK_TZ).isoformat()
        tomorrow = (bangkok_today() + timedelta(days=1)).isoformat()

        cases = [
            ("replay-bad-1", "not-a-date", created, "วันที่"),
            ("replay-bad-2", bangkok_today().isoformat(), "not-a-time", "เวลา"),
            ("replay-bad-3", tomorrow, created, "อนาคต"),
        ]
        for key, business_date, created_at, expected in cases:
            with self.subTest(key=key):
                response = self.replay(key, business_date, created_at)
                self.assertEqual(response.status_code, 400)
                self.assertIn(expected, response.get_json()["error"])

    def test_utc_offline_timestamp_is_converted_to_bangkok(self):
        # 2026-08-25T20:30:00Z is 2026-08-26 03:30 in Bangkok.
        response = self.replay("replay-utc-1", "2026-08-26", "2026-08-25T20:30:00.000Z")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["orderNumber"].startswith("202608260330"))


if __name__ == "__main__":
    unittest.main()
