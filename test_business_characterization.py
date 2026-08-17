import atexit
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


_import_db_file = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
_import_db_file.close()
os.environ["SQLITE_PATH"] = _import_db_file.name
os.environ.setdefault("POS_PIN", "2468")
os.environ.setdefault("SECRET_KEY", "test-only-secret-key")
os.environ.setdefault("PROMPTPAY_ID", "0801234567")


def _remove_import_database():
    try:
        os.unlink(_import_db_file.name)
    except FileNotFoundError:
        pass


atexit.register(_remove_import_database)

import database  # noqa: E402
import server  # noqa: E402


class PosApiTestCase(unittest.TestCase):
    def setUp(self):
        handle = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        handle.close()
        self.db_path = Path(handle.name)
        self.original_sqlite_path = database.SQLITE_PATH
        database.SQLITE_PATH = self.db_path
        database.init_schema()
        self.client = server.app.test_client()
        response = self.client.post("/api/auth/login", json={"pin": "2468"})
        self.assertEqual(response.status_code, 200)

    def tearDown(self):
        database.SQLITE_PATH = self.original_sqlite_path
        try:
            self.db_path.unlink()
        except FileNotFoundError:
            pass

    def execute(self, query, params=()):
        connection = database.connect_db()
        try:
            cursor = connection.execute(query, params)
            connection.commit()
            return cursor.lastrowid
        finally:
            connection.close()

    def one(self, query, params=()):
        connection = database.connect_db()
        try:
            return connection.execute(query, params).fetchone()
        finally:
            connection.close()

    def all(self, query, params=()):
        connection = database.connect_db()
        try:
            return connection.execute(query, params).fetchall()
        finally:
            connection.close()

    def add_product(self, sku="P001", price=69, cost=20, stock=10, active=1):
        return self.execute(
            """INSERT INTO products
               (sku, barcode, name, category, unit_price, cost_price,
                stock_qty, stock_min, is_active, image_url)
               VALUES (?, '', ?, 'Tiramisu', ?, ?, ?, 0, ?, '')""",
            (sku, f"Product {sku}", price, cost, stock, active),
        )

    def create_order(
        self,
        items,
        key="order-key",
        payment="cash",
        discount=0,
        customer_type="walkin",
    ):
        return self.client.post(
            "/api/orders",
            headers={"Idempotency-Key": key},
            json={
                "items": items,
                "paymentMethod": payment,
                "customerType": customer_type,
                "discount": discount,
            },
        )


class CheckoutCharacterizationTests(PosApiTestCase):
    def test_successful_cash_checkout_records_payment_and_zero_vat(self):
        product_id = self.add_product(price=69, stock=5)
        response = self.create_order([{"productId": product_id, "qty": 2}], discount=7)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["subtotal"], 138)
        self.assertEqual(response.get_json()["discount"], 7)
        self.assertEqual(response.get_json()["vat"], 0)
        self.assertEqual(response.get_json()["total"], 131)
        payment = self.one("SELECT payment_method, paid_amount, change_amount FROM payments")
        self.assertEqual(tuple(payment), ("cash", 131, 0))

    def test_successful_transfer_checkout(self):
        product_id = self.add_product(price=100)
        response = self.create_order(
            [{"productId": product_id, "qty": 1}], key="transfer-key", payment="transfer"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["paymentMethod"], "transfer")
        self.assertEqual(self.one("SELECT payment_method FROM payments")[0], "transfer")

    def test_server_product_price_is_authoritative(self):
        product_id = self.add_product(price=125)
        response = self.create_order(
            [{"productId": product_id, "qty": 2, "price": 1}], key="server-price"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["subtotal"], 250)
        self.assertEqual(
            tuple(self.one("SELECT unit_price, line_total FROM order_items")),
            (125, 250),
        )

    def test_checkout_rejects_insufficient_stock_without_partial_writes(self):
        first_id = self.add_product(sku="P001", stock=5)
        second_id = self.add_product(sku="P002", stock=1)
        response = self.create_order(
            [
                {"productId": first_id, "qty": 2},
                {"productId": second_id, "qty": 2},
            ],
            key="insufficient",
        )

        self.assertEqual(response.status_code, 400)
        for table in ("orders", "order_items", "payments", "stock_movements"):
            self.assertEqual(self.one(f"SELECT COUNT(*) FROM {table}")[0], 0)
        self.assertEqual(self.one("SELECT stock_qty FROM products WHERE id=?", (first_id,))[0], 5)
        self.assertEqual(self.one("SELECT stock_qty FROM products WHERE id=?", (second_id,))[0], 1)

    def test_checkout_deducts_stock_exactly_once_for_duplicate_key(self):
        product_id = self.add_product(stock=5)
        first = self.create_order([{"productId": product_id, "qty": 2}], key="same-key")
        second = self.create_order([{"productId": product_id, "qty": 2}], key="same-key")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.get_json()["duplicate"])
        self.assertEqual(self.one("SELECT stock_qty FROM products WHERE id=?", (product_id,))[0], 3)
        self.assertEqual(self.one("SELECT COUNT(*) FROM orders")[0], 1)
        self.assertEqual(self.one("SELECT COUNT(*) FROM stock_movements")[0], 1)

    def test_giveaway_consumes_stock_but_generates_no_revenue(self):
        product_id = self.add_product(price=69, stock=5)
        response = self.create_order(
            [{"productId": product_id, "qty": 3, "giveawayQty": 2}], key="giveaway"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["subtotal"], 69)
        self.assertEqual(response.get_json()["total"], 69)
        self.assertEqual(self.one("SELECT stock_qty FROM products WHERE id=?", (product_id,))[0], 2)
        movements = self.all(
            "SELECT movement_type, reference_type, quantity FROM stock_movements ORDER BY id"
        )
        self.assertEqual([tuple(row) for row in movements], [("sale", "order", -1), ("stock_out", "giveaway", -2)])

    def test_manual_discount_may_equal_subtotal_but_not_exceed_it(self):
        product_id = self.add_product(price=69, stock=2)
        accepted = self.create_order(
            [{"productId": product_id, "qty": 1}], key="full-discount", discount=69
        )
        rejected = self.create_order(
            [{"productId": product_id, "qty": 1}], key="excess-discount", discount=70
        )

        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.get_json()["total"], 0)
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(self.one("SELECT COUNT(*) FROM orders")[0], 1)


class CancellationCharacterizationTests(PosApiTestCase):
    def test_cancel_restores_paid_and_giveaway_stock_and_records_reversals(self):
        product_id = self.add_product(stock=10)
        self.create_order(
            [{"productId": product_id, "qty": 4, "giveawayQty": 1}], key="cancel-me"
        )
        order_id = self.one("SELECT id FROM orders")[0]

        response = self.client.post(f"/api/orders/{order_id}/cancel")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.one("SELECT stock_qty FROM products WHERE id=?", (product_id,))[0], 10)
        movements = self.all("SELECT reference_type, quantity FROM stock_movements ORDER BY id")
        self.assertEqual([tuple(row) for row in movements], [("order", -3), ("giveaway", -1), ("order", 3), ("giveaway", 1)])

    def test_cancelled_order_is_excluded_from_daily_totals_and_second_cancel_is_rejected(self):
        product_id = self.add_product(stock=3)
        self.create_order([{"productId": product_id, "qty": 1}], key="cancel-totals")
        order_id = self.one("SELECT id FROM orders")[0]
        first = self.client.post(f"/api/orders/{order_id}/cancel")
        second = self.client.post(f"/api/orders/{order_id}/cancel")
        summary = self.client.get("/api/reports/daily-summary").get_json()

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(summary["orderCount"], 0)
        self.assertEqual(summary["totalRevenue"], 0)

    def test_non_completed_order_cannot_be_cancelled(self):
        order_id = self.execute(
            """INSERT INTO orders
               (order_number, idempotency_key, order_date, payment_method,
                subtotal, discount, vat, total, status)
               VALUES ('PENDING-1', 'pending-key', ?, 'cash', 0, 0, 0, 0, 'pending')""",
            (server.bangkok_today().isoformat(),),
        )

        response = self.client.post(f"/api/orders/{order_id}/cancel")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.one("SELECT status FROM orders WHERE id=?", (order_id,))[0], "pending")


class StockAdjustmentCharacterizationTests(PosApiTestCase):
    def adjust(self, product_id, reason, quantity):
        return self.client.post(
            "/api/stock/adjust",
            json={"productId": product_id, "reason": reason, "quantity": quantity},
        )

    def test_prepare_increases_stock_and_giveaway_and_waste_decrease_it(self):
        product_id = self.add_product(stock=5)
        self.assertEqual(self.adjust(product_id, "prepare", 3).status_code, 200)
        self.assertEqual(self.adjust(product_id, "giveaway", 2).status_code, 200)
        self.assertEqual(self.adjust(product_id, "waste", 1).status_code, 200)

        self.assertEqual(self.one("SELECT stock_qty FROM products WHERE id=?", (product_id,))[0], 5)
        rows = self.all("SELECT reference_type, quantity FROM stock_movements ORDER BY id")
        self.assertEqual([tuple(row) for row in rows], [("daily_prep", 3), ("giveaway", -2), ("waste", -1)])

    def test_stock_adjustment_cannot_make_stock_negative(self):
        product_id = self.add_product(stock=1)
        response = self.adjust(product_id, "waste", 2)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.one("SELECT stock_qty FROM products WHERE id=?", (product_id,))[0], 1)
        self.assertEqual(self.one("SELECT COUNT(*) FROM stock_movements")[0], 0)

    def test_undo_cannot_exceed_todays_applicable_adjustment(self):
        product_id = self.add_product(stock=5)
        self.adjust(product_id, "prepare", 2)
        self.adjust(product_id, "giveaway", 1)

        self.assertEqual(self.adjust(product_id, "undo_prepare", 3).status_code, 400)
        self.assertEqual(self.adjust(product_id, "undo_giveaway", 2).status_code, 400)
        self.assertEqual(self.adjust(product_id, "undo_waste", 1).status_code, 400)
        self.assertEqual(self.one("SELECT stock_qty FROM products WHERE id=?", (product_id,))[0], 6)

    def test_historical_summary_is_read_only_and_future_summary_is_rejected(self):
        product_id = self.add_product(stock=5)
        before = self.one("SELECT COUNT(*) FROM stock_movements")[0]
        past = (server.bangkok_today() - timedelta(days=1)).isoformat()
        future = (server.bangkok_today() + timedelta(days=1)).isoformat()

        self.assertEqual(self.client.get(f"/api/stock/daily-summary?date={past}").status_code, 200)
        self.assertEqual(self.client.get(f"/api/stock/daily-summary?date={future}").status_code, 400)
        self.assertEqual(self.one("SELECT COUNT(*) FROM stock_movements")[0], before)
        self.assertEqual(self.one("SELECT stock_qty FROM products WHERE id=?", (product_id,))[0], 5)

    def test_product_edit_replaces_stock_without_creating_adjustment_movement(self):
        product_id = self.add_product(stock=5)
        response = self.client.put(
            f"/api/products/{product_id}",
            json={
                "code": "P001",
                "name": "Edited product",
                "category": "Tiramisu",
                "price": 69,
                "cost": 20,
                "stock": 12,
                "minStock": 0,
                "active": True,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.one("SELECT stock_qty FROM products WHERE id=?", (product_id,))[0], 12)
        self.assertEqual(self.one("SELECT COUNT(*) FROM stock_movements")[0], 0)


class StockPlanningCharacterizationTests(PosApiTestCase):
    def test_future_plan_is_pending_and_can_be_cancelled(self):
        product_id = self.add_product(stock=5)
        plan_date = (server.bangkok_today() + timedelta(days=2)).isoformat()
        created = self.client.post(
            "/api/stock/plans", json={"productId": product_id, "date": plan_date, "quantity": 4}
        )
        plan_id = created.get_json()["id"]

        self.assertEqual(created.status_code, 200)
        plans = self.client.get("/api/stock/plans").get_json()
        self.assertEqual(plans[0]["quantity"], 4)
        self.assertEqual(self.client.delete(f"/api/stock/plans/{plan_id}").status_code, 200)
        self.assertEqual(self.one("SELECT status FROM stock_plans WHERE id=?", (plan_id,))[0], "cancelled")

    def test_same_day_plan_applies_once_increases_stock_and_creates_prep_movement(self):
        product_id = self.add_product(stock=5)
        today = server.bangkok_today().isoformat()
        created = self.client.post(
            "/api/stock/plans", json={"productId": product_id, "date": today, "quantity": 4}
        )
        plan_id = created.get_json()["id"]

        self.assertEqual(created.status_code, 200)
        self.assertEqual(self.one("SELECT stock_qty FROM products WHERE id=?", (product_id,))[0], 9)
        self.assertEqual(self.one("SELECT status FROM stock_plans WHERE id=?", (plan_id,))[0], "applied")
        movement = self.one(
            "SELECT movement_type, reference_type, reference_id, quantity FROM stock_movements"
        )
        self.assertEqual(tuple(movement), ("stock_in", "daily_prep", str(plan_id), 4))

        self.client.get("/api/stock/daily-summary")
        self.client.get("/api/stock/daily-summary")
        self.assertEqual(self.one("SELECT stock_qty FROM products WHERE id=?", (product_id,))[0], 9)
        self.assertEqual(self.one("SELECT COUNT(*) FROM stock_movements")[0], 1)
        self.assertEqual(self.client.delete(f"/api/stock/plans/{plan_id}").status_code, 400)


class ReportsCharacterizationTests(PosApiTestCase):
    def test_reports_separate_payment_totals_and_reflect_discounts(self):
        product_id = self.add_product(price=100, stock=5)
        self.create_order([{"productId": product_id, "qty": 1}], key="cash", discount=10)
        self.create_order(
            [{"productId": product_id, "qty": 2}], key="transfer", payment="transfer", discount=5
        )

        summary = self.client.get("/api/reports/daily-summary").get_json()
        report = self.client.get("/api/reports/close-day").get_json()
        self.assertEqual(summary["cashTotal"], 90)
        self.assertEqual(summary["transferTotal"], 195)
        self.assertEqual(summary["totalRevenue"], 285)
        self.assertEqual(report["subtotalAll"], 300)
        self.assertEqual(report["discountAll"], 15)

    def test_report_cost_includes_giveaway_quantity_while_revenue_does_not(self):
        product_id = self.add_product(price=69, cost=20, stock=5)
        self.create_order(
            [{"productId": product_id, "qty": 3, "giveawayQty": 2}], key="report-giveaway"
        )

        report = self.client.get("/api/reports/close-day").get_json()
        self.assertEqual(report["totalRevenue"], 69)
        self.assertEqual(report["costTotal"], 60)
        self.assertEqual(report["netProfit"], 9)
        self.assertEqual(report["menuSummary"][0]["sold"], 1)
        self.assertEqual(report["menuSummary"][0]["giveaway"], 2)

    def test_close_day_records_and_reclosing_updates_timestamp(self):
        first = self.client.post("/api/reports/close-day")
        report_date = first.get_json()["date"]
        self.execute(
            "UPDATE daily_closures SET closed_at='2000-01-01 00:00:00' WHERE report_date=?",
            (report_date,),
        )
        second = self.client.post("/api/reports/close-day")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertNotEqual(self.one("SELECT closed_at FROM daily_closures")[0], "2000-01-01 00:00:00")
        self.assertEqual(self.one("SELECT COUNT(*) FROM daily_closures")[0], 1)

    def test_closing_day_does_not_block_later_orders_and_cancelled_orders_are_excluded(self):
        product_id = self.add_product(price=50, stock=5)
        self.client.post("/api/reports/close-day")
        later = self.create_order([{"productId": product_id, "qty": 1}], key="after-close")
        cancelled = self.create_order([{"productId": product_id, "qty": 1}], key="then-cancel")
        cancelled_id = self.one("SELECT id FROM orders WHERE idempotency_key='then-cancel'")[0]
        self.client.post(f"/api/orders/{cancelled_id}/cancel")

        report = self.client.get("/api/reports/close-day").get_json()
        self.assertEqual(later.status_code, 200)
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(report["orderCount"], 1)
        self.assertEqual(report["totalRevenue"], 50)


class FixedDateTime(datetime):
    current = datetime(2026, 8, 17, 17, 30, tzinfo=timezone.utc)

    @classmethod
    def now(cls, tz=None):
        return cls.current.astimezone(tz) if tz else cls.current.replace(tzinfo=None)


class BangkokTimezoneCharacterizationTests(PosApiTestCase):
    def test_bangkok_today_rolls_over_while_utc_is_still_previous_day(self):
        with patch.object(server, "datetime", FixedDateTime):
            self.assertEqual(server.bangkok_today().isoformat(), "2026-08-18")

    def test_checkout_near_utc_rollover_uses_bangkok_business_date(self):
        product_id = self.add_product(stock=2)
        with patch.object(server, "datetime", FixedDateTime):
            response = self.create_order(
                [{"productId": product_id, "qty": 1}], key="bangkok-rollover"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.one("SELECT order_date FROM orders")[0], "2026-08-18")
        self.assertTrue(response.get_json()["orderNumber"].startswith("20260818"))

    def test_local_timestamp_converts_utc_to_bangkok(self):
        converted = server.local_timestamp("2026-08-17 17:30:00")
        self.assertTrue(converted.startswith("2026-08-18T00:30:00"))
        self.assertTrue(converted.endswith("+07:00"))


if __name__ == "__main__":
    unittest.main()
