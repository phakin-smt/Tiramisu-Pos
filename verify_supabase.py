import contextlib
import io
import os
import runpy
import threading
import uuid

from database import connect_db, execute, transaction


EXPECTED_TABLES = {
    'customers',
    'order_items',
    'orders',
    'payments',
    'products',
    'stock_movements',
}
CURRENT_TEST = 'startup'


def fetch_value(cursor, query, params=()):
    row = execute(cursor, query, params).fetchone()
    return next(iter(row.values()))


def cleanup(prefix, sku):
    with transaction() as (_, cursor):
        order_rows = execute(
            cursor,
            'SELECT id,order_number FROM orders WHERE idempotency_key LIKE ?',
            (prefix + '%',),
        ).fetchall()
        order_ids = [row['id'] for row in order_rows]
        order_numbers = [row['order_number'] for row in order_rows]
        for order_number in order_numbers:
            execute(
                cursor,
                'DELETE FROM stock_movements WHERE reference_type=\'order\' AND reference_id=?',
                (order_number,),
            )
        for order_id in order_ids:
            execute(cursor, 'DELETE FROM orders WHERE id=?', (order_id,))
        execute(cursor, 'DELETE FROM products WHERE sku=?', (sku,))


def post_order(app, product_id, key, payment='cash'):
    with app.test_client() as client:
        with client.session_transaction() as test_session:
            test_session['authenticated'] = True
            test_session.permanent = True
        response = client.post(
            '/api/orders',
            json={
                'items': [{'productId': product_id, 'qty': 1}],
                'paymentMethod': payment,
                'customerType': 'walkin',
                'discount': 0,
            },
            headers={'Idempotency-Key': key},
        )
        return response.status_code, response.get_json(silent=True) or {}


def run():
    global CURRENT_TEST
    CURRENT_TEST = 'environment'
    if not os.getenv('DATABASE_URL'):
        raise RuntimeError('DATABASE_URL is not set')

    prefix = 'codex-test-' + uuid.uuid4().hex
    sku = 'TEST-' + uuid.uuid4().hex[:12].upper()
    created = False

    try:
        CURRENT_TEST = 'tables'
        connection = connect_db()
        try:
            cursor = connection.cursor()
            table_rows = execute(
                cursor,
                "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
            ).fetchall()
            tables = {row['table_name'] for row in table_rows}
            missing = EXPECTED_TABLES - tables
            if missing:
                raise AssertionError('required tables are missing')

            CURRENT_TEST = 'seed_data'
            seed_count = fetch_value(
                cursor,
                'SELECT COUNT(*) count FROM products WHERE sku LIKE ?',
                ('M%',),
            )
            if seed_count < 18:
                raise AssertionError('seed products are incomplete')

            stock_before = {
                row['sku']: row['stock_qty']
                for row in execute(
                    cursor,
                    'SELECT sku,stock_qty FROM products WHERE sku LIKE ?',
                    ('M%',),
                ).fetchall()
            }
        finally:
            connection.close()

        CURRENT_TEST = 'repeat_seed'
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            runpy.run_path('init_db.py', run_name='__supabase_seed_repeat__')

        connection = connect_db()
        try:
            cursor = connection.cursor()
            stock_after = {
                row['sku']: row['stock_qty']
                for row in execute(
                    cursor,
                    'SELECT sku,stock_qty FROM products WHERE sku LIKE ?',
                    ('M%',),
                ).fetchall()
            }
            if stock_before != stock_after:
                raise AssertionError('repeated seed changed stock')
        finally:
            connection.close()

        CURRENT_TEST = 'test_fixture'
        with transaction() as (_, cursor):
            result = execute(
                cursor,
                "INSERT INTO products (sku,name,category,unit_price,cost_price,stock_qty,stock_min,is_active) VALUES (?,?,'Tiramisu',69,20,4,0,1) RETURNING id",
                (sku, 'Automated verification product'),
            )
            product_id = result.fetchone()['id']
            created = True

        CURRENT_TEST = 'health_products'
        import server

        server.app.logger.disabled = True
        with server.app.test_client() as client:
            with client.session_transaction() as test_session:
                test_session['authenticated'] = True
                test_session.permanent = True
            health = client.get('/api/health')
            products = client.get('/api/products')
            daily_before = client.get('/api/reports/daily-summary').get_json()
            if health.status_code != 200 or health.get_json().get('database') != 'postgresql':
                raise AssertionError('health endpoint failed')
            if products.status_code != 200:
                raise AssertionError('product endpoint failed')

        CURRENT_TEST = 'cash_checkout'
        cash_key = prefix + '-cash'
        status, cash = post_order(server.app, product_id, cash_key, 'cash')
        if status != 200 or cash.get('total') != 69:
            raise AssertionError('cash checkout failed')
        CURRENT_TEST = 'sequential_idempotency'
        status, duplicate = post_order(server.app, product_id, cash_key, 'cash')
        if status != 200 or not duplicate.get('duplicate'):
            raise AssertionError('sequential idempotency failed')

        CURRENT_TEST = 'transfer_checkout'
        status, transfer = post_order(
            server.app,
            product_id,
            prefix + '-transfer',
            'transfer',
        )
        if status != 200 or transfer.get('paymentMethod') != 'transfer':
            raise AssertionError('transfer checkout failed')

        CURRENT_TEST = 'concurrent_idempotency'
        same_results = []
        same_barrier = threading.Barrier(2)

        def same_request():
            same_barrier.wait()
            same_results.append(
                post_order(server.app, product_id, prefix + '-same', 'cash')
            )

        same_threads = [threading.Thread(target=same_request) for _ in range(2)]
        for thread in same_threads:
            thread.start()
        for thread in same_threads:
            thread.join()
        if sorted(status for status, _ in same_results) != [200, 200]:
            raise AssertionError('concurrent idempotency failed')
        if sum(bool(body.get('duplicate')) for _, body in same_results) != 1:
            raise AssertionError('concurrent duplicate result is incorrect')

        CURRENT_TEST = 'concurrent_stock'
        race_results = []
        race_barrier = threading.Barrier(2)

        def competing_request(suffix):
            race_barrier.wait()
            race_results.append(
                post_order(server.app, product_id, prefix + suffix, 'cash')
            )

        race_threads = [
            threading.Thread(target=competing_request, args=('-race-a',)),
            threading.Thread(target=competing_request, args=('-race-b',)),
        ]
        for thread in race_threads:
            thread.start()
        for thread in race_threads:
            thread.join()
        if sorted(status for status, _ in race_results) != [200, 400]:
            raise AssertionError('concurrent stock protection failed')

        CURRENT_TEST = 'transaction_records'
        connection = connect_db()
        try:
            cursor = connection.cursor()
            stock = fetch_value(
                cursor,
                'SELECT stock_qty FROM products WHERE id=?',
                (product_id,),
            )
            order_count = fetch_value(
                cursor,
                'SELECT COUNT(*) count FROM orders WHERE idempotency_key LIKE ?',
                (prefix + '%',),
            )
            payment_count = fetch_value(
                cursor,
                'SELECT COUNT(*) count FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.idempotency_key LIKE ?',
                (prefix + '%',),
            )
            movement_count = fetch_value(
                cursor,
                "SELECT COUNT(*) count FROM stock_movements WHERE reference_type='order' AND reference_id IN (SELECT order_number FROM orders WHERE idempotency_key LIKE ?)",
                (prefix + '%',),
            )
            if (stock, order_count, payment_count, movement_count) != (0, 4, 4, 4):
                raise AssertionError('transaction records are inconsistent')
        finally:
            connection.close()

        CURRENT_TEST = 'reports'
        with server.app.test_client() as client:
            with client.session_transaction() as test_session:
                test_session['authenticated'] = True
                test_session.permanent = True
            daily_after = client.get('/api/reports/daily-summary').get_json()
            stock_report = client.get('/api/stock/daily-summary')
            close_report = client.get('/api/reports/close-day')
            if daily_after['orderCount'] != daily_before['orderCount'] + 4:
                raise AssertionError('daily summary did not include test orders')
            if stock_report.status_code != 200 or close_report.status_code != 200:
                raise AssertionError('report endpoint failed')

        print('tables: PASS')
        print('seed products: PASS ({})'.format(seed_count))
        print('repeat seed preserves stock: PASS')
        print('health and product loading: PASS')
        print('cash and transfer checkout: PASS')
        print('transaction records and stock deduction: PASS')
        print('sequential and concurrent idempotency: PASS')
        print('concurrent stock protection: PASS')
        print('daily, stock, and close-day reports: PASS')
    finally:
        if created:
            try:
                cleanup(prefix, sku)
                connection = connect_db()
                try:
                    cursor = connection.cursor()
                    leftovers = fetch_value(
                        cursor,
                        'SELECT COUNT(*) count FROM orders WHERE idempotency_key LIKE ?',
                        (prefix + '%',),
                    )
                    product_left = fetch_value(
                        cursor,
                        'SELECT COUNT(*) count FROM products WHERE sku=?',
                        (sku,),
                    )
                    if leftovers or product_left:
                        raise AssertionError('test cleanup was incomplete')
                finally:
                    connection.close()
            except Exception:
                CURRENT_TEST = 'cleanup'
                raise
            print('test data cleanup: PASS')


if __name__ == '__main__':
    try:
        run()
    except Exception as exc:
        sqlstate = getattr(exc, 'sqlstate', None)
        if sqlstate is None and exc.__cause__ is not None:
            sqlstate = getattr(exc.__cause__, 'sqlstate', None)
        if not isinstance(sqlstate, str) or len(sqlstate) != 5:
            sqlstate = 'NONE'
        sqlstate = ''.join(
            character for character in sqlstate.upper() if character.isalnum()
        )
        if len(sqlstate) != 5:
            sqlstate = 'NONE'
        print(
            'verification: FAILED test={} type={} sqlstate={}'.format(
                CURRENT_TEST,
                type(exc).__name__,
                sqlstate,
            )
        )
        raise SystemExit(1)
