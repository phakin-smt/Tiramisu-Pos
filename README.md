# Bellies Buddy POS

ระบบขายหน้าร้านสำหรับร้านขนม รองรับการขายสินค้า จัดการสต็อก ตรวจสอบออเดอร์ และสรุปยอดขายรายวัน ออกแบบให้ใช้งานได้ทั้งบนคอมพิวเตอร์และโทรศัพท์มือถือ

เวอร์ชันปัจจุบัน: **v1.1.0**

## ฟีเจอร์หลัก

- เข้าสู่ระบบด้วย PIN กลางของร้าน
- แสดงรายการสินค้า แยกตามหมวดหมู่ และค้นหาสินค้า
- ตะกร้าสินค้า คำนวณยอดและส่วนลดแบบเรียลไทม์
- รองรับการชำระด้วยเงินสดและการโอนผ่านพร้อมเพย์
- ป้องกันการบันทึกออเดอร์ซ้ำด้วย Idempotency Key
- ตัดสต็อกอัตโนมัติเมื่อขายสินค้า
- ยกเลิกออเดอร์และคืนสต็อก
- เพิ่ม แก้ไข ปิดใช้งาน และลบเมนูสินค้า
- บันทึกสินค้าเตรียมขาย สินค้าแถม ของเสีย และการแก้ไขยอดสต็อก
- วางแผนเตรียมสต็อกล่วงหน้า
- ดูออเดอร์และรายงานยอดขายตามวันที่
- สรุปยอดปิดการขาย แยกเงินสด เงินโอน ส่วนลด ต้นทุน และกำไรขั้นต้น
- UI แบบ Responsive พร้อมตะกร้าแบบ Bottom Sheet บนมือถือ
- รองรับ SQLite สำหรับใช้งานบนเครื่อง และ PostgreSQL/Supabase สำหรับ Production
- รองรับการ Deploy บน Vercel

## เทคโนโลยีที่ใช้

- Backend: Python 3.12 และ Flask
- Frontend: HTML, CSS และ Vanilla JavaScript
- Database: SQLite หรือ PostgreSQL
- Production hosting: Vercel

โปรเจกต์นี้ไม่มีขั้นตอน `npm build` เนื่องจากหน้าเว็บเป็นไฟล์ Static ที่ Flask ให้บริการโดยตรง

## โครงสร้างโปรเจกต์

```text
Tiramisu-Pos/
├── public/
│   ├── index.html          # โครงสร้างหน้าเว็บ
│   ├── app.js              # Logic ฝั่งหน้าเว็บ
│   └── styles.css          # รูปแบบและ Responsive UI
├── private_data/
│   └── payment_qr.py       # รูป QR พร้อมเพย์ที่ฝังไว้ในระบบ
├── server.py               # Flask application และ API routes
├── database.py             # การเชื่อมต่อ SQLite/PostgreSQL
├── init_db.py              # สร้างฐานข้อมูลและข้อมูลเริ่มต้น
├── schema.sql              # Schema สำหรับ SQLite
├── schema_postgres.sql     # Schema สำหรับ PostgreSQL
├── verify_supabase.py      # Smoke test สำหรับ PostgreSQL/Supabase
├── requirements.txt        # Python dependencies
├── .env.example            # ตัวอย่าง Environment Variables
└── vercel.json             # การตั้งค่า Vercel
```

## การติดตั้งและรันบนเครื่อง

### 1. ติดตั้ง Python

แนะนำ Python 3.12 จากนั้นตรวจสอบเวอร์ชัน:

```powershell
python --version
```

### 2. สร้าง Virtual Environment

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 3. ติดตั้ง Dependencies

```powershell
python -m pip install -r requirements.txt
```

### 4. ตั้งค่า Environment Variables

อย่างน้อยต้องตั้ง `POS_PIN` และ `SECRET_KEY` ก่อนเปิดระบบ:

```powershell
$env:POS_PIN="1234"
$env:SECRET_KEY="replace-with-a-long-random-secret"
```

ควรเปลี่ยนค่าเหล่านี้เป็นค่าที่คาดเดายาก และไม่ควร commit ค่าจริงลง Git

### 5. เตรียมฐานข้อมูล

```powershell
python init_db.py
```

หากไม่กำหนด `DATABASE_URL` ระบบจะใช้ไฟล์ SQLite `pos.db` ในโฟลเดอร์โปรเจกต์โดยอัตโนมัติ

### 6. เปิดเซิร์ฟเวอร์

```powershell
python server.py
```

เปิดเว็บที่ [http://localhost:8000](http://localhost:8000) และเข้าสู่ระบบด้วยค่าที่ตั้งไว้ใน `POS_PIN`

เมื่อแก้ Environment Variables ต้องหยุดเซิร์ฟเวอร์ด้วย `Ctrl + C` แล้วเปิดใหม่

## Environment Variables

| ตัวแปร | จำเป็น | คำอธิบาย |
|---|---:|---|
| `POS_PIN` | ใช่ | PIN กลางสำหรับเข้าสู่ระบบ |
| `SECRET_KEY` | ใช่ | Secret สำหรับเข้ารหัส Flask session |
| `SESSION_MINUTES` | ไม่ | อายุ session เป็นนาที ค่าเริ่มต้น 480 นาที |
| `DATABASE_URL` | ไม่ | PostgreSQL connection string หากไม่ตั้งจะใช้ SQLite |
| `SQLITE_PATH` | ไม่ | ตำแหน่งไฟล์ SQLite ที่ต้องการใช้แทน `pos.db` |

ตัวอย่างสำหรับ Local Development:

```powershell
$env:POS_PIN="1234"
$env:SECRET_KEY="replace-with-a-long-random-secret"
$env:SESSION_MINUTES="480"
python server.py
```

> หมายเหตุ: โปรเจกต์บน branch `main` ปัจจุบันใช้รูป QR พร้อมเพย์ที่ฝังอยู่ใน `private_data/payment_qr.py` จึงไม่มีตัวแปร `PROMPTPAY_ID` และ QR ไม่ได้เปลี่ยนตามยอดเงิน ลูกค้าต้องกรอกยอดโอนเอง และพนักงานต้องกดยืนยันการรับเงินด้วยตนเอง

## การใช้ PostgreSQL หรือ Supabase

กำหนด `DATABASE_URL` ก่อนสร้าง schema และเปิดเซิร์ฟเวอร์:

```powershell
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE"
python init_db.py
python server.py
```

ตรวจสอบการเชื่อมต่อด้วย:

```powershell
python verify_supabase.py
```

ระบบจะเลือกฐานข้อมูลอัตโนมัติ:

- มี `DATABASE_URL` → PostgreSQL
- ไม่มี `DATABASE_URL` → SQLite

## การ Deploy บน Vercel

1. Push โปรเจกต์ขึ้น GitHub
2. Import repository เข้า Vercel
3. เพิ่ม Environment Variables ใน Project Settings
4. ตั้ง `POS_PIN`, `SECRET_KEY` และ `DATABASE_URL`
5. Redeploy หลังเพิ่มหรือแก้ Environment Variables

สำหรับ Production ควรใช้ PostgreSQL/Supabase เพราะ filesystem ของ Vercel ไม่เหมาะกับการเก็บฐานข้อมูล SQLite แบบถาวร

## การตรวจสอบระบบ

ตรวจ syntax ของ Python:

```powershell
python -m compileall -q database.py server.py init_db.py private_data
```

ตรวจ syntax ของ JavaScript:

```powershell
node --check public/app.js
```

ตรวจสถานะระบบหลังเปิดเซิร์ฟเวอร์:

```powershell
curl.exe http://localhost:8000/api/health
```

ตัวอย่างผลลัพธ์:

```json
{"database":"sqlite","status":"ok"}
```

## ข้อจำกัดปัจจุบัน

- ใช้ PIN กลางเพียงชุดเดียว ยังไม่มีบัญชีผู้ใช้หรือการแบ่งสิทธิ์ตามบทบาท
- ไม่มี Payment Gateway หรือการตรวจสอบยอดโอนอัตโนมัติ
- QR พร้อมเพย์เป็นรูปภาพคงที่ ไม่ได้ฝังยอดของออเดอร์
- ปุ่มพักออเดอร์ยังไม่ได้บันทึกออเดอร์ไว้จริง
- ยังไม่มีระบบพิมพ์ใบเสร็จหรือหน้าใบเสร็จรายออเดอร์

## ความปลอดภัย

- ห้าม commit ค่า `POS_PIN`, `SECRET_KEY` หรือ `DATABASE_URL` จริงลง repository
- ใช้ `SECRET_KEY` ที่ยาวและสุ่มสำหรับ Production
- เปลี่ยน PIN เมื่อมีบุคคลที่ไม่เกี่ยวข้องทราบค่า
- จำกัดสิทธิ์การเข้าถึงฐานข้อมูลและสำรองข้อมูลเป็นประจำ

