import atexit
import os
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo


_import_db_file = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
_import_db_file.close()
os.environ.pop("DATABASE_URL", None)
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


BANGKOK = ZoneInfo("Asia/Bangkok")
BUSINESS_DATE = date(2026, 8, 18)
UNDO_CASES = (
    ("daily_prep", "stock_in", 1, "undo_prepare"),
    ("giveaway", "stock_out", -1, "undo_giveaway"),
    ("waste", "stock_out", -1, "undo_waste"),
)


def sqlite_utc_timestamp(local_value):
    localized = datetime.fromisoformat(local_value).replace(tzinfo=BANGKOK)
    return localized.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


class BangkokStockUndoBoundaryTests(unittest.TestCase):
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
        self.product_sequence = 0

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

    def add_product_with_movement(self, reference_type, movement_type, quantity, local_time):
        self.product_sequence += 1
        sku = f"TZ-{self.product_sequence}"
        product_id = self.execute(
            """INSERT INTO products
               (sku,barcode,name,category,unit_price,cost_price,
                stock_qty,stock_min,is_active,image_url)
               VALUES (?,'',?,'Tiramisu',69,20,10,0,1,'')""",
            (sku, f"Timezone product {self.product_sequence}"),
        )
        self.execute(
            """INSERT INTO stock_movements
               (product_id,movement_type,quantity,reference_type,created_at)
               VALUES (?,?,?,?,?)""",
            (
                product_id,
                movement_type,
                quantity,
                reference_type,
                sqlite_utc_timestamp(local_time),
            ),
        )
        return product_id

    def undo(self, product_id, reason):
        with patch.object(server, "bangkok_today", return_value=BUSINESS_DATE):
            return self.client.post(
                "/api/stock/adjust",
                json={"productId": product_id, "reason": reason, "quantity": 1},
            )

    def test_all_undo_types_include_movements_throughout_the_bangkok_day(self):
        local_times = ("00:01", "03:00", "06:59", "07:00", "12:00", "23:59")

        for reference_type, movement_type, quantity, reason in UNDO_CASES:
            for local_time in local_times:
                with self.subTest(reason=reason, local_time=local_time):
                    product_id = self.add_product_with_movement(
                        reference_type,
                        movement_type,
                        quantity,
                        f"2026-08-18T{local_time}:00",
                    )
                    response = self.undo(product_id, reason)
                    self.assertEqual(response.status_code, 200, response.get_json())

    def test_bangkok_midnight_boundaries_are_half_open_for_all_undo_types(self):
        boundaries = (
            ("2026-08-17T23:59:59", False),
            ("2026-08-18T00:00:00", True),
            ("2026-08-19T00:00:00", False),
        )

        for reference_type, movement_type, quantity, reason in UNDO_CASES:
            for local_time, should_succeed in boundaries:
                with self.subTest(reason=reason, local_time=local_time):
                    product_id = self.add_product_with_movement(
                        reference_type, movement_type, quantity, local_time
                    )
                    response = self.undo(product_id, reason)
                    self.assertEqual(response.status_code, 200 if should_succeed else 400)

    def test_local_day_bounds_are_utc_and_adapter_safe(self):
        with patch.object(server, "is_postgres", return_value=False):
            self.assertEqual(
                server.local_day_bounds("2026-08-18"),
                ("2026-08-17 17:00:00", "2026-08-18 17:00:00"),
            )

        with patch.object(server, "is_postgres", return_value=True):
            start, end = server.local_day_bounds("2026-08-18")
        self.assertEqual(start, datetime(2026, 8, 17, 17, tzinfo=timezone.utc))
        self.assertEqual(end, datetime(2026, 8, 18, 17, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
