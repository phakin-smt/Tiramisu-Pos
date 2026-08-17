"""Start the real Flask app with deterministic, disposable E2E data."""

import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


FRONTEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = FRONTEND_ROOT.parent
RUNTIME_ROOT = (FRONTEND_ROOT / ".playwright").resolve()
DATABASE_PATH = (RUNTIME_ROOT / "bellies-buddy-e2e.sqlite").resolve()

if os.getenv("DATABASE_URL", "").strip():
    raise SystemExit("E2E refused to start: DATABASE_URL is set. Tests must never use PostgreSQL/Supabase.")
if RUNTIME_ROOT not in DATABASE_PATH.parents:
    raise SystemExit("E2E refused to start: SQLite path escaped the test runtime directory.")

RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
for candidate in (DATABASE_PATH, Path(f"{DATABASE_PATH}-wal"), Path(f"{DATABASE_PATH}-shm")):
    if candidate.exists():
        candidate.unlink()

os.environ["DATABASE_URL"] = ""
os.environ["SQLITE_PATH"] = str(DATABASE_PATH)
os.environ["POS_PIN"] = "2468"
os.environ["SECRET_KEY"] = "playwright-only-secret-key"
os.environ["PROMPTPAY_ID"] = "0801234567"
os.environ["APP_TIMEZONE"] = "Asia/Bangkok"
os.environ.pop("VERCEL", None)
sys.path.insert(0, str(REPO_ROOT))

import database  # noqa: E402


database.init_schema()
products = [
    ("E2E-ORI", "E2E Original", "Tiramisu", 69, 20, 20, 2, 1),
    ("E2E-COF", "E2E Coffee", "Tiramisu", 69, 25, 15, 2, 1),
    ("E2E-STK", "E2E Stock Item", "E2E Stock", 50, 10, 3, 1, 1),
    ("E2E-ZERO", "E2E Zero Stock", "E2E Stock", 40, 8, 0, 1, 1),
    ("E2E-UNDO", "E2E Undo Item", "E2E Stock", 55, 12, 4, 1, 1),
    ("E2E-LONG", "ทีรามิสุรสช็อกโกแลตเข้มข้นพิเศษสำหรับทดสอบหน้าจอ", "Tiramisu", 89, 30, 6, 1, 1),
]
customers = [
    ("E2E-WALKIN", "E2E Walk-in", "walkin"),
    ("E2E-MEMBER", "E2E Member", "member"),
    ("E2E-STORE", "E2E Store", "store"),
]
with database.transaction() as (_, cursor):
    for sku, name, category, price, cost, stock, minimum, active in products:
        database.execute(
            cursor,
            """INSERT INTO products
               (sku,barcode,name,category,unit_price,cost_price,stock_qty,stock_min,is_active,image_url)
               VALUES (?,'',?,?,?,?,?,?,?,'')""",
            (sku, name, category, price, cost, stock, minimum, active),
        )
    for code, name, customer_type in customers:
        database.execute(
            cursor,
            """INSERT INTO customers
               (customer_code,full_name,phone,email,customer_type,is_active)
               VALUES (?,?,'','',?,1)""",
            (code, name, customer_type),
        )
    undo_product = database.execute(cursor, "SELECT id FROM products WHERE sku=?", ("E2E-UNDO",)).fetchone()
    movement_date = datetime.now(ZoneInfo("Asia/Bangkok")).date().isoformat()
    for movement_type, quantity, reference_type in (
        ("stock_in", 1, "daily_prep"),
        ("stock_out", -1, "giveaway"),
        ("stock_out", -1, "waste"),
    ):
        database.execute(
            cursor,
            """INSERT INTO stock_movements
               (product_id,movement_type,quantity,reference_type,note,created_at)
               VALUES (?,?,?,?,?,?)""",
            (undo_product["id"], movement_type, quantity, reference_type, "E2E undo fixture", f"{movement_date} 00:00:00"),
        )

from server import app  # noqa: E402


print(f"E2E Flask using isolated SQLite: {DATABASE_PATH}", flush=True)
app.run(host="127.0.0.1", port=8011, debug=False, use_reloader=False, threaded=True)
