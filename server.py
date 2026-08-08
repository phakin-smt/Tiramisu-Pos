import json
import mimetypes
import re
import sqlite3
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

PRODUCT_ID_RE = re.compile(r'^/api/products/(\d+)$')

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / 'pos.db'

CATEGORY_ICONS = {
    'Tiramisu': '🍮',
    'Cheesecake': '🍰',
    'Doughnut': '🍩',
}
DEFAULT_ICON = '🧁'
PAYMENT_METHODS = {'cash', 'transfer'}

STOCK_REASONS = {
    'prepare': {'movement_type': 'stock_in', 'reference_type': 'daily_prep', 'sign': 1, 'default_note': 'เตรียมขายวันนี้'},
    'giveaway': {'movement_type': 'stock_out', 'reference_type': 'giveaway', 'sign': -1, 'default_note': 'แถมลูกค้า'},
    'waste': {'movement_type': 'stock_out', 'reference_type': 'waste', 'sign': -1, 'default_note': 'ของเสีย/หมดอายุ'},
    'correction': {'movement_type': 'adjust', 'reference_type': 'correction', 'sign': None, 'default_note': 'ปรับยอดสต็อก'},
}


def connect_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/products':
            self.send_json_products()
            return

        if path == '/api/products/categories':
            self.send_json_categories()
            return

        if path == '/api/reports/daily-summary':
            query = parse_qs(parsed.query)
            report_date = query.get('date', [None])[0] or date.today().isoformat()
            self.send_json_daily_summary(report_date)
            return

        if path == '/api/stock/daily-summary':
            query = parse_qs(parsed.query)
            report_date = query.get('date', [None])[0] or date.today().isoformat()
            self.send_json_stock_daily_summary(report_date)
            return

        if path == '/api/health':
            self.send_json({'status': 'ok', 'database': str(DB_PATH)})
            return

        file_path = ROOT / path.lstrip('/')
        if not file_path.is_absolute():
            file_path = ROOT / path.lstrip('/')

        if path == '/' or path == '':
            file_path = ROOT / 'index.html'

        if file_path.exists() and file_path.is_file():
            self.serve_file(file_path)
        else:
            self.send_error(404, 'Not Found')

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == '/api/orders':
            self.create_order()
            return

        if parsed.path == '/api/stock/adjust':
            self.adjust_stock()
            return

        if parsed.path == '/api/products':
            self.create_product()
            return

        self.send_error(404, 'Not Found')

    def do_PUT(self):
        parsed = urlparse(self.path)
        match = PRODUCT_ID_RE.match(parsed.path)

        if match:
            self.update_product(int(match.group(1)))
            return

        self.send_error(404, 'Not Found')

    def do_DELETE(self):
        parsed = urlparse(self.path)
        match = PRODUCT_ID_RE.match(parsed.path)

        if match:
            self.delete_product(int(match.group(1)))
            return

        self.send_error(404, 'Not Found')

    def read_json_body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length) or b'{}')

    def parse_product_payload(self, payload):
        sku = str(payload.get('code', '')).strip()
        name = str(payload.get('name', '')).strip()
        category = str(payload.get('category', '')).strip()

        if not sku or not name or not category:
            return None, 'กรุณากรอกรหัสเมนู ชื่อเมนู และหมวดหมู่ให้ครบ'

        try:
            price = float(payload.get('price'))
            cost = float(payload.get('cost', 0) or 0)
            stock = int(payload.get('stock', 0) or 0)
            stock_min = int(payload.get('minStock', 0) or 0)
        except (TypeError, ValueError):
            return None, 'ราคาหรือจำนวนไม่ถูกต้อง'

        if price < 0 or cost < 0 or stock < 0 or stock_min < 0:
            return None, 'ค่าตัวเลขต้องไม่ติดลบ'

        active = 1 if payload.get('active', True) else 0

        return {
            'sku': sku,
            'name': name,
            'category': category,
            'price': price,
            'cost': cost,
            'stock': stock,
            'stock_min': stock_min,
            'active': active
        }, None

    def send_error_json(self, status, message):
        body = json.dumps({'error': message}, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def create_order(self):
        length = int(self.headers.get('Content-Length', 0))
        try:
            payload = json.loads(self.rfile.read(length) or b'{}')
        except json.JSONDecodeError:
            self.send_error_json(400, 'Invalid JSON body')
            return

        items = payload.get('items') or []
        payment_method = payload.get('paymentMethod', 'cash')
        customer_type = payload.get('customerType', 'walkin')
        note = payload.get('note')

        if not items:
            self.send_error_json(400, 'ตะกร้าว่างเปล่า')
            return

        if payment_method not in PAYMENT_METHODS:
            self.send_error_json(400, 'วิธีชำระเงินไม่ถูกต้อง')
            return

        try:
            requested_discount = float(payload.get('discount', 0) or 0)
        except (TypeError, ValueError):
            self.send_error_json(400, 'ส่วนลดไม่ถูกต้อง')
            return

        if requested_discount < 0:
            self.send_error_json(400, 'ส่วนลดต้องไม่ติดลบ')
            return

        conn = connect_db()
        try:
            cursor = conn.cursor()

            line_items = []
            subtotal = 0.0
            for item in items:
                product = cursor.execute(
                    'SELECT id, sku, name, unit_price, stock_qty FROM products WHERE id = ? AND is_active = 1',
                    (item.get('productId'),)
                ).fetchone()
                if not product:
                    self.send_error_json(400, f"ไม่พบสินค้ารหัส {item.get('productId')}")
                    return

                qty = int(item.get('qty', 0))
                if qty <= 0:
                    self.send_error_json(400, f"จำนวนสินค้า {product['name']} ไม่ถูกต้อง")
                    return

                if qty > product['stock_qty']:
                    self.send_error_json(400, f"{product['name']} คงเหลือไม่พอ (เหลือ {product['stock_qty']} ชิ้น)")
                    return

                line_total = qty * product['unit_price']
                subtotal += line_total
                line_items.append({
                    'product_id': product['id'],
                    'sku': product['sku'],
                    'name': product['name'],
                    'qty': qty,
                    'unit_price': product['unit_price'],
                    'line_total': line_total
                })

            if requested_discount > subtotal:
                self.send_error_json(400, 'ส่วนลดมากกว่ายอดรวม')
                return

            discount = requested_discount
            vat = 0.0
            total = subtotal - discount + vat
            order_date = date.today().isoformat()

            seq = cursor.execute(
                "SELECT COUNT(*) FROM orders WHERE order_date = ?", (order_date,)
            ).fetchone()[0] + 1
            order_number = f"{order_date.replace('-', '')}-{seq:04d}"

            customer = cursor.execute(
                'SELECT id FROM customers WHERE customer_type = ? AND is_active = 1 LIMIT 1',
                (customer_type,)
            ).fetchone()
            customer_id = customer['id'] if customer else None

            cursor.execute(
                """
                INSERT INTO orders (order_number, order_date, customer_id, payment_method, subtotal, discount, vat, total, status, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
                """,
                (order_number, order_date, customer_id, payment_method, subtotal, discount, vat, total, note)
            )
            order_id = cursor.lastrowid

            for line in line_items:
                cursor.execute(
                    """
                    INSERT INTO order_items (order_id, product_id, product_name, sku, quantity, unit_price, discount, line_total)
                    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
                    """,
                    (order_id, line['product_id'], line['name'], line['sku'], line['qty'], line['unit_price'], line['line_total'])
                )
                cursor.execute(
                    'UPDATE products SET stock_qty = stock_qty - ?, updated_at = datetime(\'now\') WHERE id = ?',
                    (line['qty'], line['product_id'])
                )
                cursor.execute(
                    """
                    INSERT INTO stock_movements (product_id, movement_type, quantity, reference_type, reference_id, note)
                    VALUES (?, 'sale', ?, 'order', ?, NULL)
                    """,
                    (line['product_id'], -line['qty'], order_number)
                )

            cursor.execute(
                """
                INSERT INTO payments (order_id, payment_method, paid_amount, change_amount, payment_reference)
                VALUES (?, ?, ?, 0, ?)
                """,
                (order_id, payment_method, total, order_number)
            )

            conn.commit()

            self.send_json({
                'orderNumber': order_number,
                'subtotal': subtotal,
                'discount': discount,
                'vat': vat,
                'total': total,
                'paymentMethod': payment_method
            })
        except sqlite3.IntegrityError as exc:
            conn.rollback()
            self.send_error_json(400, str(exc))
        finally:
            conn.close()

    def send_json_daily_summary(self, report_date):
        conn = connect_db()
        rows = conn.execute(
            """
            SELECT payment_method, COUNT(*) as order_count, COALESCE(SUM(total), 0) as amount
            FROM orders
            WHERE order_date = ? AND status = 'completed'
            GROUP BY payment_method
            """,
            (report_date,)
        ).fetchall()
        conn.close()

        cash_total = 0.0
        transfer_total = 0.0
        order_count = 0

        for row in rows:
            order_count += row['order_count']
            if row['payment_method'] == 'cash':
                cash_total += row['amount']
            else:
                transfer_total += row['amount']

        self.send_json({
            'date': report_date,
            'orderCount': order_count,
            'cashTotal': cash_total,
            'transferTotal': transfer_total,
            'totalRevenue': cash_total + transfer_total
        })

    def adjust_stock(self):
        length = int(self.headers.get('Content-Length', 0))
        try:
            payload = json.loads(self.rfile.read(length) or b'{}')
        except json.JSONDecodeError:
            self.send_error_json(400, 'Invalid JSON body')
            return

        product_id = payload.get('productId')
        reason = payload.get('reason')
        note = payload.get('note')

        if reason not in STOCK_REASONS:
            self.send_error_json(400, 'ประเภทการปรับสต็อกไม่ถูกต้อง')
            return

        try:
            quantity = int(payload.get('quantity', 0))
        except (TypeError, ValueError):
            self.send_error_json(400, 'จำนวนไม่ถูกต้อง')
            return

        if quantity == 0:
            self.send_error_json(400, 'จำนวนต้องไม่เป็นศูนย์')
            return

        rule = STOCK_REASONS[reason]
        delta = quantity if rule['sign'] is None else rule['sign'] * abs(quantity)

        conn = connect_db()
        try:
            cursor = conn.cursor()
            product = cursor.execute(
                'SELECT id, name, stock_qty FROM products WHERE id = ?', (product_id,)
            ).fetchone()

            if not product:
                self.send_error_json(404, 'ไม่พบสินค้า')
                return

            new_stock = product['stock_qty'] + delta
            if new_stock < 0:
                self.send_error_json(400, f"{product['name']} มีสต็อกไม่พอ (เหลือ {product['stock_qty']} ชิ้น)")
                return

            cursor.execute(
                "UPDATE products SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?",
                (new_stock, product_id)
            )
            cursor.execute(
                """
                INSERT INTO stock_movements (product_id, movement_type, quantity, reference_type, reference_id, note)
                VALUES (?, ?, ?, ?, NULL, ?)
                """,
                (product_id, rule['movement_type'], delta, rule['reference_type'], note or rule['default_note'])
            )

            conn.commit()
            self.send_json({'productId': product_id, 'stock': new_stock})
        except sqlite3.IntegrityError as exc:
            conn.rollback()
            self.send_error_json(400, str(exc))
        finally:
            conn.close()

    def send_json_stock_daily_summary(self, report_date):
        conn = connect_db()
        products = conn.execute(
            """
            SELECT id, sku, name, category, unit_price, cost_price, stock_qty, stock_min, is_active
            FROM products
            ORDER BY category, name
            """
        ).fetchall()

        movement_rows = conn.execute(
            """
            SELECT product_id, movement_type, reference_type, SUM(quantity) as total_qty
            FROM stock_movements
            WHERE date(created_at) = ?
            GROUP BY product_id, movement_type, reference_type
            """,
            (report_date,)
        ).fetchall()
        conn.close()

        movements_by_product = {}
        for row in movement_rows:
            bucket = movements_by_product.setdefault(row['product_id'], {'prepared': 0, 'sold': 0, 'giveaway': 0, 'waste': 0})
            if row['movement_type'] == 'stock_in' and row['reference_type'] == 'daily_prep':
                bucket['prepared'] += row['total_qty']
            elif row['movement_type'] == 'sale':
                bucket['sold'] += -row['total_qty']
            elif row['movement_type'] == 'stock_out' and row['reference_type'] == 'giveaway':
                bucket['giveaway'] += -row['total_qty']
            elif row['movement_type'] == 'stock_out' and row['reference_type'] == 'waste':
                bucket['waste'] += -row['total_qty']

        items = []
        for product in products:
            m = movements_by_product.get(product['id'], {'prepared': 0, 'sold': 0, 'giveaway': 0, 'waste': 0})
            prepared = m['prepared']
            sell_through = round(m['sold'] / prepared, 4) if prepared > 0 else None

            items.append({
                'productId': product['id'],
                'code': product['sku'],
                'name': product['name'],
                'category': product['category'],
                'icon': CATEGORY_ICONS.get(product['category'], DEFAULT_ICON),
                'active': bool(product['is_active']),
                'price': float(product['unit_price']),
                'cost': float(product['cost_price']) if product['cost_price'] is not None else 0,
                'minStock': int(product['stock_min']),
                'stockNow': product['stock_qty'],
                'prepared': prepared,
                'sold': m['sold'],
                'giveaway': m['giveaway'],
                'waste': m['waste'],
                'sellThrough': sell_through
            })

        self.send_json({'date': report_date, 'items': items})

    def send_json(self, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json_products(self):
        conn = connect_db()
        rows = conn.execute(
            """
            SELECT id, sku, barcode, name, category, unit_price, cost_price, stock_qty, stock_min, is_active, image_url
            FROM products
            WHERE is_active = 1
            ORDER BY category, name
            """
        ).fetchall()
        conn.close()

        products = []
        for row in rows:
            products.append({
                'id': row['id'],
                'code': row['sku'],
                'barcode': row['barcode'],
                'category': row['category'],
                'name': row['name'],
                'price': float(row['unit_price']),
                'cost': float(row['cost_price']) if row['cost_price'] is not None else 0,
                'stock': int(row['stock_qty']),
                'minStock': int(row['stock_min']),
                'active': bool(row['is_active']),
                'icon': CATEGORY_ICONS.get(row['category'], DEFAULT_ICON)
            })

        self.send_json(products)

    def send_json_categories(self):
        conn = connect_db()
        rows = conn.execute("SELECT DISTINCT category FROM products WHERE is_active = 1 ORDER BY category").fetchall()
        conn.close()
        categories = [row['category'] for row in rows]
        self.send_json({'categories': categories})

    def create_product(self):
        try:
            payload = self.read_json_body()
        except json.JSONDecodeError:
            self.send_error_json(400, 'Invalid JSON body')
            return

        data, error = self.parse_product_payload(payload)
        if error:
            self.send_error_json(400, error)
            return

        conn = connect_db()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO products (sku, barcode, name, category, unit_price, cost_price, stock_qty, stock_min, is_active, image_url)
                VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, '')
                """,
                (data['sku'], data['name'], data['category'], data['price'], data['cost'], data['stock'], data['stock_min'], data['active'])
            )
            conn.commit()
            self.send_json({'id': cursor.lastrowid, 'code': data['sku']})
        except sqlite3.IntegrityError:
            conn.rollback()
            self.send_error_json(400, f"รหัสเมนู {data['sku']} มีอยู่แล้ว")
        finally:
            conn.close()

    def update_product(self, product_id):
        try:
            payload = self.read_json_body()
        except json.JSONDecodeError:
            self.send_error_json(400, 'Invalid JSON body')
            return

        data, error = self.parse_product_payload(payload)
        if error:
            self.send_error_json(400, error)
            return

        conn = connect_db()
        try:
            cursor = conn.cursor()
            existing = cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,)).fetchone()
            if not existing:
                self.send_error_json(404, 'ไม่พบเมนูนี้')
                return

            cursor.execute(
                """
                UPDATE products
                SET sku = ?, name = ?, category = ?, unit_price = ?, cost_price = ?,
                    stock_qty = ?, stock_min = ?, is_active = ?, updated_at = datetime('now')
                WHERE id = ?
                """,
                (data['sku'], data['name'], data['category'], data['price'], data['cost'],
                 data['stock'], data['stock_min'], data['active'], product_id)
            )
            conn.commit()
            self.send_json({'id': product_id, 'code': data['sku']})
        except sqlite3.IntegrityError:
            conn.rollback()
            self.send_error_json(400, f"รหัสเมนู {data['sku']} มีอยู่แล้ว")
        finally:
            conn.close()

    def delete_product(self, product_id):
        conn = connect_db()
        try:
            cursor = conn.cursor()
            product = cursor.execute('SELECT id, name FROM products WHERE id = ?', (product_id,)).fetchone()
            if not product:
                self.send_error_json(404, 'ไม่พบเมนูนี้')
                return

            try:
                cursor.execute('DELETE FROM products WHERE id = ?', (product_id,))
                conn.commit()
                self.send_json({'id': product_id, 'deleted': True})
            except sqlite3.IntegrityError:
                conn.rollback()
                cursor.execute(
                    "UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?",
                    (product_id,)
                )
                conn.commit()
                self.send_json({
                    'id': product_id,
                    'deleted': False,
                    'deactivated': True,
                    'message': f"{product['name']} มีประวัติการขายอยู่ จึงปิดการขายแทนการลบถาวร"
                })
        finally:
            conn.close()

    def serve_file(self, file_path):
        content_type = mimetypes.guess_type(str(file_path))[0] or 'application/octet-stream'
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    port = 8000
    httpd = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    print(f'Serving POS app at http://localhost:{port}')
    httpd.serve_forever()
