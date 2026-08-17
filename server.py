import os
import hmac
import secrets
import threading
import time
from io import BytesIO
from datetime import date
from datetime import datetime
from datetime import timedelta
from datetime import timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, redirect, request, send_file, send_from_directory, session
import qrcode
from qrcode.constants import ERROR_CORRECT_M
from werkzeug.exceptions import NotFound
from database import ROOT, connect_db, execute, init_schema, is_postgres, transaction
from promptpay_qr import PromptPayError, generate_promptpay_payload

app = Flask(__name__, static_folder=None)
PUBLIC_ROOT = ROOT / 'public'
REACT_ROOT = ROOT / 'frontend' / 'dist'
BANGKOK_TZ = ZoneInfo(os.getenv('APP_TIMEZONE', 'Asia/Bangkok'))
app.secret_key = os.getenv('SECRET_KEY') or secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Strict',
    SESSION_COOKIE_SECURE=os.getenv('VERCEL') == '1',
    PERMANENT_SESSION_LIFETIME=timedelta(
        minutes=int(os.getenv('SESSION_MINUTES', '480'))
    ),
)
LOGIN_ATTEMPTS = {}
LOGIN_ATTEMPTS_LOCK = threading.Lock()
LOGIN_LIMIT = 5
LOGIN_WINDOW_SECONDS = 300
PAYMENT_METHODS = {'cash', 'transfer'}
CATEGORY_ICONS = {'Tiramisu':'🍮', 'Cheesecake':'🍰', 'Doughnut':'🍩'}
DEFAULT_ICON = '🧁'
STOCK_REASONS = {
 'prepare':('stock_in','daily_prep',1,'เตรียมขายวันนี้'),
 'undo_prepare':('stock_in','daily_prep',-1,'ยกเลิกเตรียมขายวันนี้'),
 'giveaway':('stock_out','giveaway',-1,'แถมลูกค้า'),
 'undo_giveaway':('stock_out','giveaway',1,'ยกเลิกแถมลูกค้า'),
 'waste':('stock_out','waste',-1,'ของเสีย/หมดอายุ'),
 'undo_waste':('stock_out','waste',1,'ยกเลิกของเสีย'),
 'correction':('adjust','correction',None,'ปรับยอดสต็อก')}

def number(value): return float(value) if isinstance(value, Decimal) else value
def error(message,status=400): return jsonify(error=message),status

def bangkok_today():
 return datetime.now(BANGKOK_TZ).date()

def local_day_bounds(report_date):
 start=datetime.combine(date.fromisoformat(report_date),datetime.min.time(),tzinfo=BANGKOK_TZ)
 end=start+timedelta(days=1)
 if is_postgres(): return start.astimezone(timezone.utc),end.astimezone(timezone.utc)
 return start.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),end.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

def local_timestamp(value):
 if isinstance(value,datetime): parsed=value
 else:
  try: parsed=datetime.fromisoformat(str(value))
  except (TypeError,ValueError): return str(value)
 if parsed.tzinfo is None: parsed=parsed.replace(tzinfo=timezone.utc)
 return parsed.astimezone(BANGKOK_TZ).isoformat()

def auth_configured():
 return bool(os.getenv('POS_PIN')) and bool(os.getenv('SECRET_KEY'))

def client_key():
 return request.remote_addr or 'unknown'

def is_rate_limited(key):
 now=time.monotonic()
 with LOGIN_ATTEMPTS_LOCK:
  attempts=[stamp for stamp in LOGIN_ATTEMPTS.get(key,[]) if now-stamp<LOGIN_WINDOW_SECONDS]
  LOGIN_ATTEMPTS[key]=attempts
  return len(attempts)>=LOGIN_LIMIT

def record_failed_login(key):
 with LOGIN_ATTEMPTS_LOCK:
  LOGIN_ATTEMPTS.setdefault(key,[]).append(time.monotonic())

@app.before_request
def protect_private_routes():
 public_api={'/api/health','/api/auth/login','/api/auth/status'}
 protected_qr=request.path in {'/api/payment-qr','/assets/promptpay-qr.jpg'}
 if (request.path.startswith('/api/') and request.path not in public_api) or protected_qr:
  if not session.get('authenticated'):
   return error('กรุณาเข้าสู่ระบบใหม่',401)

@app.get('/api/auth/status')
def auth_status():
 return jsonify(authenticated=bool(session.get('authenticated')),configured=auth_configured())

@app.post('/api/auth/login')
def login():
 if not auth_configured():
  return error('ระบบ PIN ยังไม่ได้ตั้งค่า',503)
 key=client_key()
 if is_rate_limited(key):
  return error('ลอง PIN ผิดหลายครั้ง กรุณารอ 5 นาที',429)
 supplied=str((request.get_json(silent=True) or {}).get('pin',''))
 if not hmac.compare_digest(supplied,os.environ['POS_PIN']):
  record_failed_login(key)
  return error('PIN ไม่ถูกต้อง',401)
 with LOGIN_ATTEMPTS_LOCK:
  LOGIN_ATTEMPTS.pop(key,None)
 session.clear()
 session['authenticated']=True
 session.permanent=True
 return jsonify(authenticated=True)

@app.post('/api/auth/logout')
def logout():
 session.clear()
 return jsonify(authenticated=False)

@app.get('/api/payment-qr')
def payment_qr():
 promptpay_id=os.getenv('PROMPTPAY_ID','').strip()
 if not promptpay_id:
  return error('ระบบพร้อมเพย์ยังไม่ได้ตั้งค่า',503)
 try:
  payload=generate_promptpay_payload(promptpay_id,request.args.get('amount'))
 except PromptPayError:
  return error('ยอดชำระหรือเลขพร้อมเพย์ไม่ถูกต้อง')
 qr=qrcode.QRCode(version=None,error_correction=ERROR_CORRECT_M,box_size=10,border=4)
 qr.add_data(payload)
 qr.make(fit=True)
 image=qr.make_image(fill_color='black',back_color='white')
 output=BytesIO()
 image.save(output,format='PNG')
 output.seek(0)
 response=send_file(
  output,
  mimetype='image/png',
 )
 response.headers['Cache-Control']='private, no-store'
 response.headers['X-Content-Type-Options']='nosniff'
 return response

def rows(query,params=()):
 connection=connect_db()
 try: return execute(connection.cursor(),query,params).fetchall()
 finally: connection.close()

def apply_due_stock_plans(cursor,today):
 due=execute(cursor,"SELECT id,product_id,quantity FROM stock_plans WHERE status='pending' AND plan_date<=?",(today,)).fetchall()
 for plan in due:
  execute(cursor,'UPDATE products SET stock_qty=stock_qty+?,updated_at=CURRENT_TIMESTAMP WHERE id=?',(plan['quantity'],plan['product_id']))
  execute(cursor,"INSERT INTO stock_movements (product_id,movement_type,quantity,reference_type,reference_id,note) VALUES (?,'stock_in',?,'daily_prep',?,'แผนเตรียมล่วงหน้า')",(plan['product_id'],plan['quantity'],str(plan['id'])))
  execute(cursor,"UPDATE stock_plans SET status='applied',applied_at=CURRENT_TIMESTAMP WHERE id=?",(plan['id'],))

def ensure_daily_plans_applied():
 with transaction() as (_,cursor):
  apply_due_stock_plans(cursor,bangkok_today().isoformat())

def movement_summary(connection,report_date):
 start,end=local_day_bounds(report_date)
 result=execute(connection.cursor(),'SELECT product_id,movement_type,reference_type,SUM(quantity) total_qty FROM stock_movements WHERE created_at>=? AND created_at<? GROUP BY product_id,movement_type,reference_type',(start,end)).fetchall()
 summary={}
 for row in result:
  bucket=summary.setdefault(row['product_id'],{'prepared':0,'sold':0,'giveaway':0,'waste':0})
  if row['movement_type']=='stock_in' and row['reference_type']=='daily_prep': bucket['prepared']+=row['total_qty']
  elif row['movement_type']=='sale': bucket['sold']-=row['total_qty']
  elif row['reference_type']=='giveaway': bucket['giveaway']-=row['total_qty']
  elif row['reference_type']=='waste': bucket['waste']-=row['total_qty']
 return summary

@app.errorhandler(Exception)
def unexpected_error(exc):
 app.logger.exception('Request failed')
 return error('ระบบหรือฐานข้อมูลไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง',500)

@app.get('/api/health')
def health():
 connection=connect_db()
 try: execute(connection.cursor(),'SELECT 1').fetchone()
 finally: connection.close()
 return jsonify(status='ok',database='postgresql' if is_postgres() else 'sqlite')

@app.get('/api/products')
def products():
 ensure_daily_plans_applied()
 result=rows('SELECT id,sku,barcode,name,category,unit_price,cost_price,stock_qty,stock_min,is_active FROM products WHERE is_active=1 ORDER BY category,name')
 return jsonify([{'id':r['id'],'code':r['sku'],'barcode':r['barcode'],'name':r['name'],'category':r['category'],'price':number(r['unit_price']),'cost':number(r['cost_price'] or 0),'stock':r['stock_qty'],'minStock':r['stock_min'],'active':bool(r['is_active']),'icon':CATEGORY_ICONS.get(r['category'],DEFAULT_ICON)} for r in result])

@app.get('/api/products/categories')
def categories(): return jsonify(categories=[r['category'] for r in rows('SELECT DISTINCT category FROM products WHERE is_active=1 ORDER BY category')])

def product_payload(payload):
 try:
  data={'sku':str(payload.get('code','')).strip(),'name':str(payload.get('name','')).strip(),'category':str(payload.get('category','')).strip(),'price':float(payload.get('price')),'cost':float(payload.get('cost',0) or 0),'stock':int(payload.get('stock',0) or 0),'stock_min':int(payload.get('minStock',0) or 0),'active':1 if payload.get('active',True) else 0}
 except (TypeError,ValueError): return None,'ราคาหรือจำนวนไม่ถูกต้อง'
 if not data['sku'] or not data['name'] or not data['category']: return None,'กรุณากรอกรหัส ชื่อ และหมวดหมู่ให้ครบ'
 if min(data['price'],data['cost'],data['stock'],data['stock_min'])<0: return None,'ค่าตัวเลขต้องไม่ติดลบ'
 return data,None

@app.post('/api/products')
def create_product():
 data,problem=product_payload(request.get_json(silent=True) or {})
 if problem: return error(problem)
 try:
  with transaction() as (_,cursor):
   query='INSERT INTO products (sku,barcode,name,category,unit_price,cost_price,stock_qty,stock_min,is_active,image_url) VALUES (?,\'\',?,?,?,?,?,?,?,\'\')'+(' RETURNING id' if is_postgres() else '')
   result=execute(cursor,query,(data['sku'],data['name'],data['category'],data['price'],data['cost'],data['stock'],data['stock_min'],data['active']))
   product_id=result.fetchone()['id'] if is_postgres() else cursor.lastrowid
  return jsonify(id=product_id,code=data['sku'])
 except Exception as exc:
  if 'unique' in str(exc).lower(): return error('รหัสเมนู {} มีอยู่แล้ว'.format(data['sku']))
  raise

@app.put('/api/products/<int:product_id>')
def update_product(product_id):
 data,problem=product_payload(request.get_json(silent=True) or {})
 if problem: return error(problem)
 with transaction() as (_,cursor):
  if not execute(cursor,'SELECT id FROM products WHERE id=?',(product_id,)).fetchone(): return error('ไม่พบเมนูนี้',404)
  execute(cursor,'UPDATE products SET sku=?,name=?,category=?,unit_price=?,cost_price=?,stock_qty=?,stock_min=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',(data['sku'],data['name'],data['category'],data['price'],data['cost'],data['stock'],data['stock_min'],data['active'],product_id))
 return jsonify(id=product_id,code=data['sku'])

@app.patch('/api/products/<int:product_id>/active')
def update_product_active(product_id):
 payload=request.get_json(silent=True) or {}
 if not isinstance(payload.get('active'),bool): return error('สถานะเปิดขายไม่ถูกต้อง')
 with transaction() as (_,cursor):
  if not execute(cursor,'SELECT id FROM products WHERE id=?',(product_id,)).fetchone(): return error('ไม่พบเมนูนี้',404)
  execute(cursor,'UPDATE products SET is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',(1 if payload['active'] else 0,product_id))
 return jsonify(id=product_id,active=payload['active'])

@app.delete('/api/products/<int:product_id>')
def delete_product(product_id):
 with transaction() as (_,cursor):
  if not execute(cursor,'SELECT id FROM products WHERE id=?',(product_id,)).fetchone(): return error('ไม่พบเมนูนี้',404)
  used=execute(cursor,'SELECT 1 FROM order_items WHERE product_id=? LIMIT 1',(product_id,)).fetchone()
  if used: execute(cursor,'UPDATE products SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?',(product_id,))
  else: execute(cursor,'DELETE FROM products WHERE id=?',(product_id,))
 return jsonify(id=product_id,deleted=True)

@app.post('/api/orders')
def create_order():
 payload=request.get_json(silent=True) or {}; items=payload.get('items') or []; payment=payload.get('paymentMethod','cash'); key=request.headers.get('Idempotency-Key','').strip()
 if not items: return error('ตะกร้าว่างเปล่า')
 if payment not in PAYMENT_METHODS: return error('วิธีชำระเงินไม่ถูกต้อง')
 if not key or len(key)>100: return error('ไม่พบรหัสยืนยันรายการ กรุณาลองใหม่')
 try: discount=float(payload.get('discount',0) or 0)
 except (TypeError,ValueError): return error('ส่วนลดไม่ถูกต้อง')
 if discount<0: return error('ส่วนลดต้องไม่ติดลบ')
 with transaction() as (_,cursor):
  if is_postgres():
   execute(cursor,'SELECT pg_advisory_xact_lock(hashtext(?))',(key,))
  duplicate=execute(cursor,'SELECT order_number,subtotal,discount,vat,total,payment_method FROM orders WHERE idempotency_key=?',(key,)).fetchone()
  if duplicate: return jsonify(orderNumber=duplicate['order_number'],subtotal=number(duplicate['subtotal']),discount=number(duplicate['discount']),vat=number(duplicate['vat']),total=number(duplicate['total']),paymentMethod=duplicate['payment_method'],duplicate=True)
  lines=[]; subtotal=0.0; lock=' FOR UPDATE' if is_postgres() else ''
  for item in items:
   product=execute(cursor,'SELECT id,sku,name,unit_price,stock_qty FROM products WHERE id=? AND is_active=1'+lock,(item.get('productId'),)).fetchone()
   try:
    qty=int(item.get('qty',0)); giveaway_qty=int(item.get('giveawayQty',0) or 0)
   except (TypeError,ValueError): qty=0
   if not product or qty<=0 or giveaway_qty<0 or giveaway_qty>qty: return error('สินค้าในตะกร้าหรือจำนวนแถมไม่ถูกต้อง')
   if qty>product['stock_qty']: return error('{} คงเหลือไม่พอ (เหลือ {} ชิ้น)'.format(product['name'],product['stock_qty']))
   paid_qty=qty-giveaway_qty; line_total=paid_qty*float(product['unit_price']); subtotal+=line_total; lines.append((product,qty,giveaway_qty,paid_qty,line_total))
  if discount>subtotal: return error('ส่วนลดมากกว่ายอดรวม')
  total=subtotal-discount; order_time=datetime.now(BANGKOK_TZ); today=order_time.date().isoformat()
  order_base=order_time.strftime('%Y%m%d%H%M')
  if is_postgres(): execute(cursor,'SELECT pg_advisory_xact_lock(hashtext(?))',('order-number:'+order_base,))
  same_minute=execute(cursor,'SELECT COUNT(*) total FROM orders WHERE order_number=? OR order_number LIKE ?',(order_base,order_base+'-%')).fetchone()['total']
  order_number=order_base if same_minute==0 else '{}-{:02d}'.format(order_base,same_minute+1)
  customer=execute(cursor,'SELECT id FROM customers WHERE customer_type=? AND is_active=1 LIMIT 1',(payload.get('customerType','walkin'),)).fetchone()
  query='INSERT INTO orders (order_number,idempotency_key,order_date,customer_id,payment_method,subtotal,discount,vat,total,status,note) VALUES (?,?,?,?,?,?,?,0,?,\'completed\',?)'+(' RETURNING id' if is_postgres() else '')
  result=execute(cursor,query,(order_number,key,today,customer['id'] if customer else None,payment,subtotal,discount,total,payload.get('note')))
  order_id=result.fetchone()['id'] if is_postgres() else cursor.lastrowid
  for product,qty,giveaway_qty,paid_qty,line_total in lines:
   execute(cursor,'INSERT INTO order_items (order_id,product_id,product_name,sku,quantity,giveaway_qty,unit_price,discount,line_total) VALUES (?,?,?,?,?,?,?,0,?)',(order_id,product['id'],product['name'],product['sku'],qty,giveaway_qty,product['unit_price'],line_total))
   updated=execute(cursor,'UPDATE products SET stock_qty=stock_qty-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND stock_qty>=?',(qty,product['id'],qty))
   if updated.rowcount!=1: raise ValueError('สต็อกเปลี่ยนแปลง กรุณาลองใหม่')
   if paid_qty:
    execute(cursor,'INSERT INTO stock_movements (product_id,movement_type,quantity,reference_type,reference_id,note) VALUES (?,\'sale\',?,\'order\',?,NULL)',(product['id'],-paid_qty,order_number))
   if giveaway_qty:
    execute(cursor,"INSERT INTO stock_movements (product_id,movement_type,quantity,reference_type,reference_id,note) VALUES (?,'stock_out',?,'giveaway',?,'แถมในออเดอร์')",(product['id'],-giveaway_qty,order_number))
  execute(cursor,'INSERT INTO payments (order_id,payment_method,paid_amount,change_amount,payment_reference) VALUES (?,?,?,0,?)',(order_id,payment,total,order_number))
 return jsonify(orderNumber=order_number,subtotal=subtotal,discount=discount,vat=0,total=total,paymentMethod=payment)

@app.post('/api/orders/<int:order_id>/cancel')
def cancel_order(order_id):
 with transaction() as (_,cursor):
  order=execute(cursor,'SELECT id,status,order_number FROM orders WHERE id=?',(order_id,)).fetchone()
  if not order: return error('ไม่พบออเดอร์นี้',404)
  if order['status']!='completed': return error('ออเดอร์นี้ถูกยกเลิกไปแล้ว')
  items=execute(cursor,'SELECT product_id,quantity,giveaway_qty FROM order_items WHERE order_id=?',(order_id,)).fetchall()
  for item in items:
   execute(cursor,'UPDATE products SET stock_qty=stock_qty+?,updated_at=CURRENT_TIMESTAMP WHERE id=?',(item['quantity'],item['product_id']))
   paid_qty=item['quantity']-item['giveaway_qty']
   if paid_qty:
    execute(cursor,"INSERT INTO stock_movements (product_id,movement_type,quantity,reference_type,reference_id,note) VALUES (?,'sale',?,'order',?,'ยกเลิกออเดอร์')",(item['product_id'],paid_qty,order['order_number']))
   if item['giveaway_qty']:
    execute(cursor,"INSERT INTO stock_movements (product_id,movement_type,quantity,reference_type,reference_id,note) VALUES (?,'stock_out',?,'giveaway',?,'ยกเลิกออเดอร์')",(item['product_id'],item['giveaway_qty'],order['order_number']))
  execute(cursor,"UPDATE orders SET status='cancelled' WHERE id=?",(order_id,))
 return jsonify(id=order_id,cancelled=True)

@app.get('/api/orders')
def list_orders():
 report_date=request.args.get('date') or bangkok_today().isoformat()
 if report_date>bangkok_today().isoformat(): return error('เลือกวันที่ไม่เกินวันนี้')
 connection=connect_db()
 try:
  cursor=connection.cursor()
  order_rows=execute(cursor,'SELECT id,order_number,created_at,payment_method,subtotal,discount,total,status FROM orders WHERE order_date=? ORDER BY created_at',(report_date,)).fetchall()
  item_rows=execute(cursor,'SELECT oi.order_id,oi.product_name,oi.sku,oi.quantity,oi.giveaway_qty,oi.unit_price,oi.line_total FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.order_date=? ORDER BY oi.id',(report_date,)).fetchall()
 finally: connection.close()
 grouped={}
 for r in item_rows: grouped.setdefault(r['order_id'],[]).append({'name':r['product_name'],'code':r['sku'],'qty':r['quantity'],'giveawayQty':r['giveaway_qty'],'unitPrice':number(r['unit_price']),'lineTotal':number(r['line_total'])})
 orders=[{'id':r['id'],'orderNumber':r['order_number'],'time':local_timestamp(r['created_at']),'paymentMethod':r['payment_method'],'subtotal':number(r['subtotal']),'discount':number(r['discount']),'total':number(r['total']),'status':r['status'],'items':grouped.get(r['id'],[])} for r in order_rows]
 return jsonify(date=report_date,orders=orders)

@app.post('/api/stock/adjust')
def adjust_stock():
 payload=request.get_json(silent=True) or {}; reason=payload.get('reason')
 if reason not in STOCK_REASONS: return error('ประเภทการปรับสต็อกไม่ถูกต้อง')
 try: quantity=int(payload.get('quantity',0))
 except (TypeError,ValueError): return error('จำนวนไม่ถูกต้อง')
 if not quantity: return error('จำนวนต้องไม่เป็นศูนย์')
 movement,reference,sign,default_note=STOCK_REASONS[reason]; delta=quantity if sign is None else sign*abs(quantity)
 with transaction() as (_,cursor):
  product=execute(cursor,'SELECT id,name,stock_qty FROM products WHERE id=?'+(' FOR UPDATE' if is_postgres() else ''),(payload.get('productId'),)).fetchone()
  if not product: return error('ไม่พบสินค้า',404)
  if reason.startswith('undo_'):
   day_start,day_end=local_day_bounds(bangkok_today().isoformat())
  if reason=='undo_prepare':
   prepared=execute(cursor,"SELECT COALESCE(SUM(quantity),0) total FROM stock_movements WHERE product_id=? AND reference_type='daily_prep' AND created_at>=? AND created_at<?",(product['id'],day_start,day_end)).fetchone()['total']
   if prepared<abs(quantity): return error('ไม่มียอดเตรียมของวันนี้ให้ยกเลิก')
  if reason in {'undo_giveaway','undo_waste'}:
   reference_type='giveaway' if reason=='undo_giveaway' else 'waste'
   movement_total=execute(cursor,"SELECT COALESCE(SUM(quantity),0) total FROM stock_movements WHERE product_id=? AND reference_type=? AND created_at>=? AND created_at<?",(product['id'],reference_type,day_start,day_end)).fetchone()['total']
   if -movement_total<abs(quantity): return error('ไม่มีรายการของวันนี้ให้ยกเลิก')
  new_stock=product['stock_qty']+delta
  if new_stock<0: return error('{} มีสต็อกไม่พอ (เหลือ {} ชิ้น)'.format(product['name'],product['stock_qty']))
  execute(cursor,'UPDATE products SET stock_qty=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',(new_stock,product['id']))
  execute(cursor,'INSERT INTO stock_movements (product_id,movement_type,quantity,reference_type,reference_id,note) VALUES (?,?,?,?,NULL,?)',(product['id'],movement,delta,reference,payload.get('note') or default_note))
 return jsonify(productId=product['id'],stock=new_stock)

@app.get('/api/reports/daily-summary')
def daily_summary():
 report_date=request.args.get('date') or bangkok_today().isoformat()
 result=rows('SELECT payment_method,COUNT(*) order_count,COALESCE(SUM(total),0) amount FROM orders WHERE order_date=? AND status=\'completed\' GROUP BY payment_method',(report_date,))
 cash=sum(number(r['amount']) for r in result if r['payment_method']=='cash'); transfer=sum(number(r['amount']) for r in result if r['payment_method']!='cash')
 return jsonify(date=report_date,orderCount=sum(r['order_count'] for r in result),cashTotal=cash,transferTotal=transfer,totalRevenue=cash+transfer)

@app.get('/api/reports/days')
def report_days():
 order_days=rows("SELECT order_date,COUNT(*) order_count,COALESCE(SUM(total),0) total_revenue FROM orders WHERE status='completed' GROUP BY order_date ORDER BY order_date DESC")
 closure_days=rows('SELECT report_date,closed_at FROM daily_closures ORDER BY report_date DESC')
 days={r['order_date']:{'date':r['order_date'],'orderCount':r['order_count'],'totalRevenue':number(r['total_revenue']),'closedAt':None} for r in order_days}
 for closure in closure_days:
  item=days.setdefault(closure['report_date'],{'date':closure['report_date'],'orderCount':0,'totalRevenue':0,'closedAt':None})
  item['closedAt']=local_timestamp(closure['closed_at'])
 for item in days.values():
  menu_items=stock_data(item['date'])
  item['soldQty']=sum(menu['sold'] for menu in menu_items)
  item['giveawayQty']=sum(menu['giveaway'] for menu in menu_items)
  item['remainingQty']=sum(menu['stockNow'] for menu in menu_items if menu['active'])
 return jsonify(days=sorted(days.values(),key=lambda item:item['date'],reverse=True))

@app.post('/api/reports/close-day')
def mark_day_closed():
 report_date=bangkok_today().isoformat()
 with transaction() as (_,cursor):
  existing=execute(cursor,'SELECT report_date FROM daily_closures WHERE report_date=?',(report_date,)).fetchone()
  if existing: execute(cursor,'UPDATE daily_closures SET closed_at=CURRENT_TIMESTAMP WHERE report_date=?',(report_date,))
  else: execute(cursor,'INSERT INTO daily_closures (report_date) VALUES (?)',(report_date,))
  closed=execute(cursor,'SELECT closed_at FROM daily_closures WHERE report_date=?',(report_date,)).fetchone()
 return jsonify(date=report_date,closedAt=local_timestamp(closed['closed_at']))

@app.get('/api/analytics')
def analytics():
 try: days=int(request.args.get('days','7'))
 except (TypeError,ValueError): return error('ช่วงเวลาไม่ถูกต้อง')
 if days not in {1,7,30}: return error('รองรับช่วงเวลา 1, 7 หรือ 30 วัน')
 end_date=bangkok_today(); start_date=end_date-timedelta(days=days-1)
 start_iso=start_date.isoformat(); end_iso=end_date.isoformat()
 movement_start,_=local_day_bounds(start_iso); _,movement_end=local_day_bounds(end_iso)
 connection=connect_db()
 try:
  cursor=connection.cursor()
  order_summary=execute(cursor,"SELECT COUNT(*) order_count,COALESCE(SUM(total),0) revenue,COALESCE(SUM(discount),0) discount FROM orders WHERE order_date>=? AND order_date<=? AND status='completed'",(start_iso,end_iso)).fetchone()
  cost_row=execute(cursor,"SELECT COALESCE(SUM(oi.quantity*p.cost_price),0) cost_total FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id WHERE o.order_date>=? AND o.order_date<=? AND o.status='completed'",(start_iso,end_iso)).fetchone()
  daily_rows=execute(cursor,"SELECT order_date,COUNT(*) order_count,COALESCE(SUM(total),0) revenue FROM orders WHERE order_date>=? AND order_date<=? AND status='completed' GROUP BY order_date ORDER BY order_date",(start_iso,end_iso)).fetchall()
  top_rows=execute(cursor,"SELECT oi.product_id,oi.product_name,oi.sku,SUM(oi.quantity-oi.giveaway_qty) sold_qty,COALESCE(SUM(oi.line_total),0) revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.order_date>=? AND o.order_date<=? AND o.status='completed' GROUP BY oi.product_id,oi.product_name,oi.sku HAVING SUM(oi.quantity-oi.giveaway_qty)>0 ORDER BY sold_qty DESC,revenue DESC LIMIT 5",(start_iso,end_iso)).fetchall()
  loss_rows=execute(cursor,"SELECT p.id,p.name,p.sku,COALESCE(SUM(CASE WHEN sm.reference_type='giveaway' THEN -sm.quantity ELSE 0 END),0) giveaway_qty,COALESCE(SUM(CASE WHEN sm.reference_type='waste' THEN -sm.quantity ELSE 0 END),0) waste_qty FROM stock_movements sm JOIN products p ON p.id=sm.product_id WHERE sm.created_at>=? AND sm.created_at<? AND sm.reference_type IN ('giveaway','waste') GROUP BY p.id,p.name,p.sku HAVING COALESCE(SUM(CASE WHEN sm.reference_type IN ('giveaway','waste') THEN -sm.quantity ELSE 0 END),0)>0 ORDER BY (COALESCE(SUM(CASE WHEN sm.reference_type='giveaway' THEN -sm.quantity ELSE 0 END),0)+COALESCE(SUM(CASE WHEN sm.reference_type='waste' THEN -sm.quantity ELSE 0 END),0)) DESC LIMIT 5",(movement_start,movement_end)).fetchall()
  low_rows=execute(cursor,'SELECT id,name,sku,stock_qty,stock_min FROM products WHERE is_active=1 AND stock_qty<=stock_min ORDER BY stock_qty,stock_min DESC,name LIMIT 8').fetchall()
 finally: connection.close()
 daily_map={r['order_date']:r for r in daily_rows}
 daily=[]
 for offset in range(days):
  day=(start_date+timedelta(days=offset)).isoformat(); row=daily_map.get(day)
  daily.append({'date':day,'orderCount':row['order_count'] if row else 0,'revenue':number(row['revenue']) if row else 0})
 revenue=number(order_summary['revenue']); order_count=order_summary['order_count']; cost_total=number(cost_row['cost_total'])
 return jsonify(
  startDate=start_iso,endDate=end_iso,
  overview={'revenue':revenue,'orderCount':order_count,'averageTicket':round(revenue/order_count,2) if order_count else 0,'discount':number(order_summary['discount']),'cost':cost_total,'grossProfit':revenue-cost_total},
  daily=daily,
  topProducts=[{'productId':r['product_id'],'name':r['product_name'],'code':r['sku'],'soldQty':r['sold_qty'],'revenue':number(r['revenue'])} for r in top_rows],
  losses=[{'productId':r['id'],'name':r['name'],'code':r['sku'],'giveawayQty':r['giveaway_qty'],'wasteQty':r['waste_qty']} for r in loss_rows],
  lowStock=[{'productId':r['id'],'name':r['name'],'code':r['sku'],'stock':r['stock_qty'],'minStock':r['stock_min']} for r in low_rows]
 )

def stock_data(report_date):
 connection=connect_db()
 try:
  cursor=connection.cursor()
  result=execute(cursor,'SELECT id,sku,name,category,unit_price,cost_price,stock_qty,stock_min,is_active FROM products ORDER BY category,name').fetchall(); movements=movement_summary(connection,report_date)
  _,day_end=local_day_bounds(report_date)
  future_rows=execute(cursor,'SELECT product_id,COALESCE(SUM(quantity),0) total_qty FROM stock_movements WHERE created_at>=? GROUP BY product_id',(day_end,)).fetchall()
  future_movements={row['product_id']:row['total_qty'] for row in future_rows}
 finally: connection.close()
 items=[]
 for p in result:
  m=movements.get(p['id'],{'prepared':0,'sold':0,'giveaway':0,'waste':0}); prepared=m['prepared']
  stock_at_day_end=p['stock_qty']-future_movements.get(p['id'],0)
  items.append({'productId':p['id'],'code':p['sku'],'name':p['name'],'category':p['category'],'icon':CATEGORY_ICONS.get(p['category'],DEFAULT_ICON),'active':bool(p['is_active']),'price':number(p['unit_price']),'cost':number(p['cost_price'] or 0),'minStock':p['stock_min'],'stockNow':stock_at_day_end,**m,'sellThrough':round(m['sold']/prepared,4) if prepared else None})
 return items

@app.get('/api/stock/daily-summary')
def stock_summary():
 ensure_daily_plans_applied()
 report_date=request.args.get('date') or bangkok_today().isoformat()
 try:
  selected_date=date.fromisoformat(report_date)
 except ValueError:
  return error('รูปแบบวันที่ไม่ถูกต้อง')
 if selected_date>bangkok_today(): return error('ไม่สามารถดูข้อมูลของวันข้างหน้าได้')
 return jsonify(date=report_date,items=stock_data(report_date))

@app.get('/api/stock/plans')
def stock_plans():
 result=rows("SELECT sp.id,sp.product_id,sp.plan_date,sp.quantity,p.name,p.sku FROM stock_plans sp JOIN products p ON p.id=sp.product_id WHERE sp.status='pending' ORDER BY sp.plan_date,p.name")
 return jsonify([{'id':r['id'],'productId':r['product_id'],'date':r['plan_date'],'quantity':r['quantity'],'name':r['name'],'code':r['sku']} for r in result])

@app.post('/api/stock/plans')
def create_stock_plan():
 payload=request.get_json(silent=True) or {}
 try: quantity=int(payload.get('quantity',0))
 except (TypeError,ValueError): return error('จำนวนไม่ถูกต้อง')
 if quantity<=0: return error('จำนวนต้องมากกว่า 0')
 plan_date=str(payload.get('date','')).strip()
 today=bangkok_today().isoformat()
 if not plan_date or plan_date<today: return error('เลือกวันที่ตั้งแต่วันนี้เป็นต้นไป')
 with transaction() as (_,cursor):
  product=execute(cursor,'SELECT id FROM products WHERE id=?',(payload.get('productId'),)).fetchone()
  if not product: return error('ไม่พบสินค้า',404)
  query='INSERT INTO stock_plans (product_id,plan_date,quantity,note) VALUES (?,?,?,?)'+(' RETURNING id' if is_postgres() else '')
  result=execute(cursor,query,(product['id'],plan_date,quantity,payload.get('note')))
  plan_id=result.fetchone()['id'] if is_postgres() else cursor.lastrowid
  apply_due_stock_plans(cursor,today)
 return jsonify(id=plan_id)

@app.delete('/api/stock/plans/<int:plan_id>')
def cancel_stock_plan(plan_id):
 with transaction() as (_,cursor):
  plan=execute(cursor,'SELECT status FROM stock_plans WHERE id=?',(plan_id,)).fetchone()
  if not plan: return error('ไม่พบแผนนี้',404)
  if plan['status']!='pending': return error('แผนนี้ถูกเติมสต็อกไปแล้ว ยกเลิกไม่ได้')
  execute(cursor,"UPDATE stock_plans SET status='cancelled' WHERE id=?",(plan_id,))
 return jsonify(id=plan_id,cancelled=True)

@app.get('/api/reports/close-day')
def close_day():
 report_date=request.args.get('date') or bangkok_today().isoformat(); connection=connect_db()
 try:
  cursor=connection.cursor()
  order_rows=execute(cursor,'SELECT id,order_number,created_at,payment_method,subtotal,discount,total FROM orders WHERE order_date=? AND status=\'completed\' ORDER BY created_at',(report_date,)).fetchall()
  item_rows=execute(cursor,'SELECT oi.order_id,oi.product_name,oi.sku,oi.quantity,oi.giveaway_qty,oi.unit_price,oi.line_total FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.order_date=? AND o.status=\'completed\' ORDER BY oi.id',(report_date,)).fetchall()
  cost_rows=execute(cursor,'SELECT oi.quantity,p.cost_price FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id WHERE o.order_date=? AND o.status=\'completed\'',(report_date,)).fetchall()
 finally: connection.close()
 grouped={}
 for r in item_rows: grouped.setdefault(r['order_id'],[]).append({'name':r['product_name'],'code':r['sku'],'qty':r['quantity'],'giveawayQty':r['giveaway_qty'],'unitPrice':number(r['unit_price']),'lineTotal':number(r['line_total'])})
 orders=[{'orderNumber':r['order_number'],'time':local_timestamp(r['created_at']),'paymentMethod':r['payment_method'],'subtotal':number(r['subtotal']),'discount':number(r['discount']),'total':number(r['total']),'items':grouped.get(r['id'],[])} for r in order_rows]
 cash=sum(o['total'] for o in orders if o['paymentMethod']=='cash'); transfer=sum(o['total'] for o in orders if o['paymentMethod']!='cash')
 cost_total=sum(r['quantity']*number(r['cost_price'] or 0) for r in cost_rows)
 menus=[{'code':i['code'],'name':i['name'],'category':i['category'],'icon':i['icon'],'active':i['active'],'sold':i['sold'],'giveaway':i['giveaway'],'waste':i['waste'],'remaining':i['stockNow']} for i in stock_data(report_date) if i['active'] or i['sold'] or i['giveaway'] or i['waste']]
 return jsonify(date=report_date,orderCount=len(orders),subtotalAll=sum(o['subtotal'] for o in orders),discountAll=sum(o['discount'] for o in orders),cashTotal=cash,transferTotal=transfer,totalRevenue=cash+transfer,costTotal=cost_total,netProfit=(cash+transfer)-cost_total,orders=orders,menuSummary=menus)

@app.get('/')
def index(): return send_from_directory(PUBLIC_ROOT,'index.html')

@app.get('/next')
def react_index_redirect(): return redirect('/next/',code=308)

@app.get('/next/assets/<path:filename>')
def react_asset(filename):
 try: response=send_from_directory(REACT_ROOT / 'assets',filename)
 except NotFound: return '',404
 response.headers['Cache-Control']='public, max-age=31536000, immutable'
 return response

@app.get('/next/')
@app.get('/next/<path:route>')
def react_index(route=None):
 response=send_from_directory(REACT_ROOT,'index.html')
 response.headers['Cache-Control']='no-cache'
 return response

@app.get('/<path:filename>')
def static_files(filename):
 if filename.startswith('api/'): return error('ไม่พบ API',404)
 if filename not in {'app.js','styles.css'}: return error('ไม่พบไฟล์',404)
 return send_from_directory(PUBLIC_ROOT,filename)

init_schema()

if __name__=='__main__': app.run(host='127.0.0.1',port=int(os.getenv('PORT','8000')),debug=False)
