"""Capture the numbers a migration must not change.

Read-only by construction: every statement here is a SELECT, and the module
never calls init_schema(). Run it before a migration and again afterwards, then
diff the two files -- an empty diff is the evidence that existing data came
through untouched.

    python backend/baseline_snapshot.py before.json
    ... run the migration ...
    python backend/baseline_snapshot.py after.json
    diff before.json after.json

Works against whichever database DATABASE_URL points at, or the local SQLite
file when it is unset, exactly like the application does.
"""

import json
import sys
from datetime import date, datetime
from decimal import Decimal

from database import connect_db, execute, is_postgres


TABLES = (
    'products',
    'customers',
    'orders',
    'order_items',
    'payments',
    'stock_movements',
    'daily_closures',
    'cash_days',
    'stock_plans',
)


def plain(value):
    """Normalize engine-specific types so SQLite and PostgreSQL output matches."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def rows(cursor, query):
    # sqlite3.Row indexes by key but has no .items(); psycopg hands back real
    # dicts. keys() plus lookup is the shape both engines share.
    return [{key: plain(row[key]) for key in row.keys()}
            for row in execute(cursor, query).fetchall()]


def collect(cursor):
    snapshot = {'engine': 'postgresql' if is_postgres() else 'sqlite'}

    snapshot['tableCounts'] = {
        table: execute(cursor, 'SELECT COUNT(*) total FROM ' + table).fetchone()['total']
        for table in TABLES
    }

    # Revenue per business day, split by status so a cancelled order cannot hide
    # inside a total that still looks right.
    snapshot['ordersByDate'] = rows(cursor, """
        SELECT order_date, status, COUNT(*) order_count,
               COALESCE(SUM(subtotal), 0) subtotal,
               COALESCE(SUM(discount), 0) discount,
               COALESCE(SUM(total), 0) total
        FROM orders GROUP BY order_date, status ORDER BY order_date, status
    """)

    snapshot['paymentsByMethod'] = rows(cursor, """
        SELECT payment_method, COUNT(*) payment_count,
               COALESCE(SUM(paid_amount), 0) paid_amount
        FROM payments GROUP BY payment_method ORDER BY payment_method
    """)

    # Stock is the number most likely to drift silently, so it is recorded per
    # product rather than as a total.
    snapshot['stockBySku'] = rows(cursor, """
        SELECT sku, name, stock_qty, stock_min, is_active, unit_price, cost_price
        FROM products ORDER BY sku
    """)

    snapshot['movementTotals'] = rows(cursor, """
        SELECT movement_type, reference_type, COUNT(*) movement_count,
               COALESCE(SUM(quantity), 0) quantity
        FROM stock_movements
        GROUP BY movement_type, reference_type
        ORDER BY movement_type, reference_type
    """)

    snapshot['closedDays'] = rows(cursor, 'SELECT report_date FROM daily_closures ORDER BY report_date')

    snapshot['cashDays'] = rows(cursor, 'SELECT report_date, opening_float FROM cash_days ORDER BY report_date')

    snapshot['pendingStockPlans'] = rows(cursor, """
        SELECT plan_date, status, COUNT(*) plan_count, COALESCE(SUM(quantity), 0) quantity
        FROM stock_plans GROUP BY plan_date, status ORDER BY plan_date, status
    """)

    return snapshot


def main():
    connection = connect_db()
    try:
        snapshot = collect(connection.cursor())
    finally:
        connection.close()

    payload = json.dumps(snapshot, indent=2, ensure_ascii=False, sort_keys=True)
    if len(sys.argv) > 1:
        with open(sys.argv[1], 'w', encoding='utf-8') as handle:
            handle.write(payload + '\n')
        counts = snapshot['tableCounts']
        print('Baseline written to {} ({})'.format(sys.argv[1], snapshot['engine']))
        # ASCII only: a Windows console using cp1252 renders anything else as "?".
        print('  orders {} | order_items {} | stock_movements {} | products {}'.format(
            counts['orders'], counts['order_items'], counts['stock_movements'], counts['products']))
    else:
        print(payload)


if __name__ == '__main__':
    main()
