"""Reconciling stock after an offline sync must correct stock and nothing else."""

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
from server import BANGKOK_TZ, STOCK_RECONCILIATION_REASON, app  # noqa: E402


class StockReconciliationTests(unittest.TestCase):
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
        sku = sku or "RECON-{}".format(datetime.now().strftime("%H%M%S%f"))
        connection = connect_db()
        try:
            cursor = connection.cursor()
            execute(
                cursor,
                "INSERT INTO products (sku,name,category,unit_price,stock_qty,stock_min,is_active)"
                " VALUES (?,?,?,?,?,?,1)",
                (sku, "Recon " + sku, "Tiramisu", 69, stock, 0),
            )
            connection.commit()
            return cursor.lastrowid
        finally:
            connection.close()

    def query(self, sql, params=()):
        connection = connect_db()
        try:
            return execute(connection.cursor(), sql, params).fetchall()
        finally:
            connection.close()

    def stock_of(self, product_id):
        return self.query("SELECT stock_qty FROM products WHERE id=?", (product_id,))[0]["stock_qty"]

    def movements_of(self, product_id):
        return self.query(
            "SELECT id,movement_type,quantity,reference_type,reference_id,note"
            " FROM stock_movements WHERE product_id=? ORDER BY id",
            (product_id,),
        )

    def reconcile(self, product_id, verified_stock, **extra):
        payload = {"productId": product_id, "verifiedStock": verified_stock}
        payload.update(extra)
        return self.client.post("/api/stock/reconcile", json=payload)

    def sync_offline_sale(self, key, product_id, qty):
        created = (datetime.now(BANGKOK_TZ) - timedelta(days=1)).isoformat()
        business_date = (datetime.now(BANGKOK_TZ) - timedelta(days=1)).date().isoformat()
        return self.client.post(
            "/api/orders",
            json={
                "items": [{"productId": product_id, "qty": qty, "giveawayQty": 0}],
                "paymentMethod": "cash",
                "customerType": "walkin",
                "discount": 0,
                "offline": {"businessDate": business_date, "createdAt": created},
            },
            headers={"Idempotency-Key": key},
        )

    # --- 1, 12: sync produces a structured, aggregatable review -----------------

    def test_offline_sync_reports_the_shortfall_per_product(self):
        product_id = self.seed_product(stock=1, sku="RECON-SHORT")
        response = self.sync_offline_sale("recon-sync-1", product_id, 4)

        body = response.get_json()
        self.assertTrue(body["stockReview"])
        self.assertEqual(body["stockShortfalls"], [
            {"productId": product_id, "productName": "Recon RECON-SHORT", "shortfall": 3},
        ])
        self.assertEqual(self.stock_of(product_id), 0)

    def test_two_offline_sales_each_report_their_own_shortfall(self):
        product_id = self.seed_product(stock=2, sku="RECON-TWICE")
        first = self.sync_offline_sale("recon-sync-2a", product_id, 3).get_json()
        second = self.sync_offline_sale("recon-sync-2b", product_id, 2).get_json()

        # 2 in stock: the first is short 1, the second short 2 (stock already 0).
        self.assertEqual(first["stockShortfalls"][0]["shortfall"], 1)
        self.assertEqual(second["stockShortfalls"][0]["shortfall"], 2)
        self.assertEqual(self.stock_of(product_id), 0)

    # --- 4, 5, 6: verified count drives an atomic adjustment --------------------

    def test_verified_count_creates_one_immutable_adjustment(self):
        response = self.reconcile(self.product_id, 7)

        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["previousStock"], 10)
        self.assertEqual(body["verifiedStock"], 7)
        self.assertEqual(body["delta"], -3)
        self.assertEqual(body["currentStock"], 7)
        self.assertFalse(body["noChange"])
        self.assertEqual(body["reason"], STOCK_RECONCILIATION_REASON)

        self.assertEqual(self.stock_of(self.product_id), 7)
        movements = self.movements_of(self.product_id)
        self.assertEqual(len(movements), 1)
        self.assertEqual(movements[0]["movement_type"], "adjust")
        self.assertEqual(movements[0]["quantity"], -3)
        self.assertEqual(movements[0]["reference_type"], STOCK_RECONCILIATION_REASON)
        self.assertIn("10 → 7", movements[0]["note"])

    def test_counting_more_than_expected_adjusts_upwards(self):
        response = self.reconcile(self.product_id, 14)
        self.assertEqual(response.get_json()["delta"], 4)
        self.assertEqual(self.stock_of(self.product_id), 14)

    def test_matching_count_records_no_movement(self):
        response = self.reconcile(self.product_id, 10)

        body = response.get_json()
        self.assertTrue(body["noChange"])
        self.assertEqual(body["delta"], 0)
        self.assertEqual(self.stock_of(self.product_id), 10)
        self.assertEqual(self.movements_of(self.product_id), [])

    # --- 7, 8: invalid input never moves stock ----------------------------------

    def test_stock_cannot_be_driven_negative_or_set_from_junk(self):
        for value in (-1, "abc", 5.5, None, True, "", "3abc"):
            with self.subTest(value=value):
                response = self.reconcile(self.product_id, value)
                self.assertEqual(response.status_code, 400)
                self.assertIn("จำนวนเต็ม", response.get_json()["error"])
                self.assertEqual(self.stock_of(self.product_id), 10)
                self.assertEqual(self.movements_of(self.product_id), [])

    def test_unknown_product_is_rejected_without_touching_stock(self):
        response = self.reconcile(999999, 5)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.stock_of(self.product_id), 10)

    # --- 9: repeated submission is naturally idempotent -------------------------

    def test_repeating_the_same_verified_count_cannot_double_adjust(self):
        first = self.reconcile(self.product_id, 6).get_json()
        second = self.reconcile(self.product_id, 6).get_json()

        self.assertEqual(first["delta"], -4)
        # The count is absolute, so replaying it is a no-op rather than -4 again.
        self.assertEqual(second["delta"], 0)
        self.assertTrue(second["noChange"])
        self.assertEqual(self.stock_of(self.product_id), 6)
        self.assertEqual(len(self.movements_of(self.product_id)), 1)

    # --- 10, 11: history stays immutable ----------------------------------------

    def test_reconciliation_leaves_orders_and_their_movements_untouched(self):
        product_id = self.seed_product(stock=1, sku="RECON-HISTORY")
        sale = self.sync_offline_sale("recon-history-1", product_id, 3).get_json()
        orders_before = self.query(
            "SELECT order_number,order_date,total,payment_method,status,note FROM orders WHERE order_number=?",
            (sale["orderNumber"],),
        )
        movements_before = self.movements_of(product_id)
        revenue_before = self.query("SELECT COALESCE(SUM(total),0) t FROM orders")[0]["t"]

        self.reconcile(product_id, 4)

        self.assertEqual(
            self.query(
                "SELECT order_number,order_date,total,payment_method,status,note FROM orders WHERE order_number=?",
                (sale["orderNumber"],),
            ),
            orders_before,
        )
        # Every pre-existing movement row is byte-identical; only a new one was added.
        after = self.movements_of(product_id)
        self.assertEqual(after[: len(movements_before)], movements_before)
        self.assertEqual(len(after), len(movements_before) + 1)
        self.assertEqual(self.query("SELECT COALESCE(SUM(total),0) t FROM orders")[0]["t"], revenue_before)

    def test_reconciliation_does_not_touch_giveaway_or_waste_totals(self):
        product_id = self.seed_product(stock=10, sku="RECON-TOTALS")
        self.client.post("/api/stock/adjust", json={"productId": product_id, "reason": "giveaway", "quantity": 2})
        self.client.post("/api/stock/adjust", json={"productId": product_id, "reason": "waste", "quantity": 1})

        def totals():
            return self.query(
                "SELECT reference_type,COALESCE(SUM(quantity),0) t FROM stock_movements"
                " WHERE product_id=? AND reference_type IN ('giveaway','waste') GROUP BY reference_type",
                (product_id,),
            )

        before = totals()
        self.reconcile(product_id, 3)
        self.assertEqual(totals(), before)

    # --- 13: stock changed externally between review and reconciliation ---------

    def test_reconciliation_uses_stock_at_confirmation_time(self):
        product_id = self.seed_product(stock=10, sku="RECON-EXTERNAL")
        # Someone sells 4 through the normal path after the review was raised.
        self.client.post(
            "/api/orders",
            json={
                "items": [{"productId": product_id, "qty": 4, "giveawayQty": 0}],
                "paymentMethod": "cash", "customerType": "walkin", "discount": 0,
            },
            headers={"Idempotency-Key": "recon-external-1"},
        )
        self.assertEqual(self.stock_of(product_id), 6)

        body = self.reconcile(product_id, 5).get_json()

        # The delta is computed against the stock it actually locked, not the
        # value the owner saw when the review was raised.
        self.assertEqual(body["previousStock"], 6)
        self.assertEqual(body["delta"], -1)
        self.assertEqual(self.stock_of(product_id), 5)

    # --- 14: authentication ------------------------------------------------------

    def test_unauthenticated_reconciliation_is_rejected(self):
        anonymous = app.test_client()
        response = anonymous.post(
            "/api/stock/reconcile", json={"productId": self.product_id, "verifiedStock": 3}
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.stock_of(self.product_id), 10)
        self.assertEqual(self.movements_of(self.product_id), [])

    # --- 15: the ordinary online path is unaffected ------------------------------

    def test_online_checkout_is_unchanged_by_the_new_response_field(self):
        product_id = self.seed_product(stock=5, sku="RECON-ONLINE")
        response = self.client.post(
            "/api/orders",
            json={
                "items": [{"productId": product_id, "qty": 2, "giveawayQty": 0}],
                "paymentMethod": "cash", "customerType": "walkin", "discount": 0,
            },
            headers={"Idempotency-Key": "recon-online-1"},
        )
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(body["stockReview"])
        self.assertEqual(body["stockShortfalls"], [])
        self.assertEqual(self.stock_of(product_id), 3)
        self.assertIsNone(
            self.query("SELECT note FROM orders WHERE order_number=?", (body["orderNumber"],))[0]["note"]
        )

    def test_reconciliation_id_is_recorded_for_tracing(self):
        self.reconcile(self.product_id, 8, reconciliationId="recon-uuid-1")
        movement = self.movements_of(self.product_id)[0]
        self.assertEqual(movement["reference_id"], "recon-uuid-1")


if __name__ == "__main__":
    unittest.main()
