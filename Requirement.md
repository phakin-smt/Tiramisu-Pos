# Requirement — Tiramisu POS

สรุป feature ที่มีอยู่จริงในระบบปัจจุบัน (อ้างอิงจากโค้ดจริง ไม่ใช่แผนในอนาคต)

## 1. ระบบยืนยันตัวตน (Authentication)
- ใช้ PIN กลางตัวเดียว (`POS_PIN` ใน env) ไม่มีระบบผู้ใช้/สิทธิ์แยกราย role
- ต้องตั้งค่าทั้ง `POS_PIN` และ `SECRET_KEY` ระบบถึงจะเปิดให้ login ได้ (ไม่งั้น login route ตอบ 503)
- `POST /api/auth/login` เช็ค PIN ด้วย `hmac.compare_digest` แล้วสร้าง Flask session (อายุ session ตั้งได้ผ่าน `SESSION_MINUTES` ค่า default 480 นาที)
- จำกัดความพยายาม login ผิด 5 ครั้ง/IP ภายใน 5 นาที (เก็บใน memory เท่านั้น รีสตาร์ทเซิร์ฟเวอร์แล้วรีเซ็ต)
- ทุก endpoint `/api/*` ถูก gate ด้วย auth ยกเว้น `/api/health`, `/api/auth/login`, `/api/auth/status` และ route รูป QR จ่ายเงิน
- ฝั่ง frontend เช็คสถานะ login ตอนโหลดหน้า และ redirect กลับหน้า login อัตโนมัติเมื่อเจอ 401

## 2. จัดการเมนู/สินค้า (Product Management)
- CRUD สินค้าเต็มรูปแบบ: `GET/POST/PUT/DELETE /api/products`, `GET /api/products/categories`
- ฟิลด์ข้อมูล: sku, name, category, unit_price, cost_price, stock_qty, stock_min, is_active
- ลบสินค้าเป็น soft delete (ตั้ง is_active=0) ถ้ามีประวัติออเดอร์ผูกอยู่ ไม่งั้นลบจริง
- ไอคอนตามหมวดหมู่ (Tiramisu 🍮, Cheesecake 🍰, Doughnut 🍩) กำหนดตายตัวในโค้ด ไม่ได้เก็บใน DB
- หน้า "จัดการสต็อก" ใช้ modal เดียวกันในการเพิ่ม/แก้ไข/ลบสินค้า

## 2.5 การเลือกร้าน (Multi-store)
- ใช้ PIN กลางเดิมตัวเดียว จากนั้นเลือกร้านที่จะขาย — ร้านที่เลือกเก็บใน Flask session (`store_id`) ปลอมจากฝั่ง client ไม่ได้
- ถ้ามีร้านเดียวที่เปิดใช้งาน ระบบเลือกให้อัตโนมัติ หน้าเลือกร้านจึงไม่แสดง
- ทั้ง `/` และ `/next/` มีหน้าเลือกร้านและปุ่มเปลี่ยนร้าน (แสดงเมื่อมีมากกว่า 1 ร้าน) และล้าง state ทั้งหมดเมื่อสลับร้าน
- `GET /api/stores`, `POST /api/auth/select-store`, `GET /api/pricing-rules`

## 3. ตะกร้าสินค้า/หน้าขาย (Cart & Checkout)
- ตะกร้าเก็บเป็น array ฝั่ง client, คำนวณยอดรวมแบบ real-time
- โปรโมชั่นบิ้วท์อิน: ซื้อครบ 3 ชิ้นราคา ฿69 → ลดเหลือ ฿200 อัตโนมัติ (ปิดได้ถ้าผู้ใช้แก้ยอดส่วนลดเอง)
- ลูกค้าประเภทร้านค้า (`store`) ได้ราคาส่ง ลด ฿9 ต่อชิ้นสำหรับหมวด Tiramisu โดย**ใช้แทน**โปรฯ 3 ชิ้น ไม่ทบกัน — ใช้เกณฑ์เดียวกันทั้งแอปเดิมและ React
- กฎราคาทั้งสองข้อข้างบนเก็บเป็นข้อมูลต่อร้านในตาราง `stores` และส่งให้หน้าเว็บผ่าน `GET /api/pricing-rules` ไม่ได้ฝังในโค้ด ร้านที่เพิ่มใหม่เริ่มจากไม่มีโปรฯ อัตโนมัติ
- VAT มีในระบบ (schema/UI) แต่ยังไม่เปิดใช้งาน (hardcode เป็น 0)
- `POST /api/orders` สร้างออเดอร์แบบ transaction เดียว: insert orders + order_items + stock_movements + payments, ตัด stock พร้อม guard กันขายเกินสต็อก (`stock_qty >= ?`)
- รองรับ **Idempotency**: client ส่ง `Idempotency-Key` header กันการกดส่งซ้ำ/double submit; ฝั่ง Postgres ใช้ advisory lock เพิ่มเติมกันชนกันตอนมี concurrent request

## 4. การชำระเงิน (Payment)
- รองรับ 2 วิธี: เงินสด (cash) และ โอน/พร้อมเพย์ (transfer)
- QR พร้อมเพย์ generate ตามยอดของแต่ละออเดอร์ — `backend/promptpay_qr.py` สร้าง EMVCo payload + CRC16 เอง แล้ว `GET /api/payment-qr?amount=` render เป็น PNG
- **ไม่มี payment gateway จริง** — ไม่มีการเชื่อมต่อธนาคารหรือตรวจสอบยอดที่โอนเข้ามา
- แคชเชียร์ต้องกดยืนยันเองว่า "โอนแล้ว" ไม่มีการตรวจสอบการโอนอัตโนมัติ/webhook ใดๆ

## 5. จัดการสต็อก (Stock Management)
- ปรับสต็อกได้ 4 เหตุผล: เตรียมของ (prepare, +), แจกฟรี (giveaway, -), ของเสีย (waste, -), แก้ไขยอด (correction, set ตรงๆ)
- ทุกการเปลี่ยนแปลงสต็อกถูกบันทึกลง `stock_movements` เป็น audit trail (รวมถึงตอนขายด้วย)
- มีสรุปยอดรายวันต่อสินค้า: เตรียม/ขายได้/แจก/เสีย พร้อมอัตรา sell-through

## 6. รายงาน (Reports)
- สรุปยอดขายรายวัน: จำนวนออเดอร์, ยอดเงินสด/โอน/รวม
- "ปิดการขายวันนี้" (close-day report): รวมทุกออเดอร์ของวัน พร้อมรายการสินค้า, แยกยอดเงินสด/โอน, ยอดขาย/ส่วนลด และสรุปขาย/แจก/เสีย/คงเหลือต่อเมนู
- หน้า "ออเดอร์" ดูออเดอร์ทีละใบตามวันที่ที่เลือกได้ (เห็นรายการสินค้า ยอด วิธีจ่าย) และยกเลิกออเดอร์พร้อมคืนสต็อกได้
- **ไม่มี**การค้นหาออเดอร์ข้ามวัน และไม่มีใบเสร็จสำหรับพิมพ์

## 7. ฐานข้อมูล (Database)
- รองรับ 2 แบบ: SQLite (ใช้ตอน dev/local) และ PostgreSQL เช่น Supabase (production) — สลับอัตโนมัติตามว่ามี `DATABASE_URL` หรือไม่
- มี schema แยก 2 ไฟล์ (`backend/schema/schema.sql` / `backend/schema/schema_postgres.sql`) โครงสร้างตารางเหมือนกัน: stores, products, customers, orders, order_items, payments, stock_movements
- ทุกตารางที่ผูกกับร้าน (products, orders, stock_movements, stock_plans, daily_closures, cash_days) มี `store_id` โดย `daily_closures` และ `cash_days` ใช้ primary key ร่วม (`store_id`, `report_date`) ส่วน sku และเลขออเดอร์ unique ภายในร้านของตัวเอง — ปัจจุบันมีร้านเดียว (`baannoi`) และทุกอย่างยังทำงานเหมือนเดิม
- `backend/init_db.py` seed สินค้าจริง 18 SKU พร้อมราคา/ต้นทุน และลูกค้าตัวอย่าง 3 ราย
- `backend/verify_supabase.py` เป็นสคริปต์ smoke test สำหรับตรวจสอบ deployment บน Postgres/Supabase (health, checkout, idempotency, concurrency, reports)
- `GET /api/health` บอกว่าตอนนี้ backend ใช้ DB แบบไหนอยู่

## 8. การ Deploy (Vercel)
- Deploy บน Vercel แบบ zero-config สำหรับ Flask (region: sin1 - Singapore)
- Flask serve ไฟล์ frontend เอง (index.html, app.js, styles.css) ผ่าน `send_from_directory` โดยจำกัดเฉพาะไฟล์ที่อนุญาต

## 9. Mobile Optimization
- ปรับ UI สำหรับมือถือ (breakpoint ≤767px): เมนูบนแบบเลื่อนแนวนอน (sticky), ปุ่ม/ช่องกรอกขนาดขั้นต่ำ 44px ตาม guideline การแตะ, ตาราง/กริดสินค้าแบบ 2 คอลัมน์
- ตะกร้าสินค้าบนมือถือเป็นแบบ bottom sheet (แถบสรุปยอด+จำนวนด้านล่าง กดเพื่อเลื่อนขึ้นมาดูตะกร้าเต็ม)
- รองรับพื้นที่ปลอดภัยของ iOS (notch/home indicator) ด้วย `env(safe-area-inset-*)`

## 10. สิ่งที่ยังไม่มี (Known Gaps)
- ไม่มีระบบผู้ใช้/สิทธิ์แยกราย role (มีแค่ PIN กลางร่วมกัน)
- ไม่มีการค้นหาออเดอร์ข้ามวัน หรือพิมพ์ใบเสร็จ (ดูรายใบตามวันที่ได้แล้ว)
- ไม่มี payment gateway จริง หรือการตรวจสอบยอดโอนอัตโนมัติ (ตัว QR generate ตามยอดแล้ว)
- ไม่มีหน้าจัดการลูกค้า (มีตาราง customers แต่ใช้แค่ dropdown ตายตัว 3 ตัวเลือกตอนเช็คเอาท์)
- ปุ่ม "พักออเดอร์" ยังไม่ทำงานจริง (แค่ toast แจ้งเตือน ไม่ได้บันทึกอะไร)
- ไม่มีระบบจัดการใบสั่งซื้อ/ซัพพลายเออร์ มีแค่การปรับยอดสต็อกแบบง่าย
