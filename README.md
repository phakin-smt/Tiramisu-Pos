# Baannoi-POS

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
- ราคาส่งสำหรับลูกค้าประเภทร้านค้า
- ตั้งเงินทอนตั้งต้นประจำวัน และเทียบกับยอดเงินสดที่ควรมีตอนปิดยอด
- ขายแบบออฟไลน์บนแอป React (PWA) และ Sync ออเดอร์ขึ้นเซิร์ฟเวอร์อัตโนมัติเมื่อกลับมาออนไลน์
- UI แบบ Responsive พร้อมตะกร้าแบบ Bottom Sheet บนมือถือ
- รองรับ SQLite สำหรับใช้งานบนเครื่อง และ PostgreSQL/Supabase สำหรับ Production
- รองรับการ Deploy บน Vercel

## เทคโนโลยีที่ใช้

**Backend**

- Python 3.12 และ Flask 3.1
- SQLite สำหรับใช้งานบนเครื่อง หรือ PostgreSQL/Supabase สำหรับ Production สลับอัตโนมัติตาม `DATABASE_URL`
- สร้าง QR พร้อมเพย์เอง (EMVCo payload + CRC16) ด้วย `qrcode`

**Frontend**

- แอปหลัก: React 19 + TypeScript + Vite build เป็น PWA (`vite-plugin-pwa`) และใช้ IndexedDB ผ่าน `idb` สำหรับการขายออฟไลน์
- แอปเดิม: HTML, CSS และ Vanilla JavaScript ที่ Flask เสิร์ฟตรงจาก `public/`
- เทสต์: Vitest + Testing Library และ Playwright สำหรับ E2E

**Deploy**

- Vercel (region `sin1`) โดย Vercel เป็นผู้ build ฝั่ง React ให้ตามที่กำหนดใน `vercel.json`

## โครงสร้างโปรเจกต์

```text
Tiramisu-Pos/
├── backend/                  # Flask API และทุกอย่างฝั่งเซิร์ฟเวอร์
│   ├── server.py             # Flask application, API routes และการเสิร์ฟทั้งสองแอป
│   ├── database.py           # การเชื่อมต่อ SQLite/PostgreSQL และจุดอ้างอิง path ของโปรเจกต์
│   ├── promptpay_qr.py       # สร้าง EMVCo payload สำหรับ QR พร้อมเพย์
│   ├── init_db.py            # สร้างฐานข้อมูลและข้อมูลเริ่มต้น
│   ├── verify_supabase.py    # Smoke test สำหรับ PostgreSQL/Supabase
│   ├── schema/               # Schema SQL แยกตามชนิดฐานข้อมูล
│   │   ├── schema.sql        # SQLite
│   │   └── schema_postgres.sql
│   └── tests/                # เทสต์ฝั่ง Backend (unittest)
├── frontend/                 # แอปหลัก React PWA เสิร์ฟที่ /next/
│   ├── src/
│   │   ├── api/              # HTTP client (timeout, 401, reachability) และ endpoint แต่ละกลุ่ม
│   │   ├── app/              # App shell และ router
│   │   ├── components/       # Layout, navigation และส่วนประกอบที่ใช้ร่วมกัน
│   │   ├── connectivity/     # สถานะออนไลน์ และการเข้าถึง backend จริง
│   │   ├── domain/           # ตรรกะล้วน: ตะกร้า โปรโมชั่น จำนวนเงิน วันที่
│   │   ├── features/         # แยกตามหน้าจอ: sell, stock, orders, reports, analytics, products-admin, auth
│   │   ├── offline/          # IndexedDB, catalog snapshot, ออเดอร์ออฟไลน์, การ Sync, trusted device
│   │   ├── pwa/              # ตั้งค่า Service Worker และ update gate
│   │   ├── types/            # TypeScript types ที่ตรงกับ API
│   │   └── styles/           # global.css
│   ├── e2e/                  # Playwright: specs, pwa, staging และ backend สำหรับเทสต์
│   ├── public/               # ไอคอน PWA
│   ├── vite.config.ts        # Base path /next/ และ dev proxy ไป Flask
│   └── package.json          # สคริปต์ dev / build / test
├── public/                   # แอปเดิม Vanilla JS เสิร์ฟที่ /
│   ├── index.html            # โครงสร้างหน้าเว็บ
│   ├── app.js                # Logic ฝั่งหน้าเว็บ
│   └── styles.css            # รูปแบบและ Responsive UI
├── requirements.txt          # Python dependencies
├── .env.example              # ตัวอย่าง Environment Variables
└── vercel.json               # การตั้งค่า Vercel
```

## สองแอปบน Backend เดียว

Flask ตัวเดียวให้บริการหน้าเว็บสองชุด ซึ่งแยกโค้ดออกจากกันโดยสิ้นเชิงและใช้ API ชุดเดียวกัน

| | แอปเดิม | แอปหลัก |
|---|---|---|
| URL | `/` | `/next/` |
| โค้ด | `public/` | `frontend/src/` |
| เทคโนโลยี | Vanilla JavaScript | React 19 + TypeScript |
| ขั้นตอน Build | ไม่มี — Flask เสิร์ฟไฟล์ตรง | ต้อง `npm run build` ให้ได้ `frontend/dist` ก่อน |
| ใช้งานออฟไลน์ | ไม่ได้ | ได้ ผ่าน Service Worker และ IndexedDB |

ทั้งสองแอปเรียก API ชุดเดียวกันที่ `/api/*` และใช้ Flask session ร่วมกัน การเข้าสู่ระบบที่แอปหนึ่งจึงมีผลกับอีกแอปด้วย ส่วนฝั่งไฟล์ Static นั้น Flask อนุญาตให้เข้าถึงเฉพาะ `app.js` และ `styles.css` ของแอปเดิมเท่านั้น

> ฟีเจอร์ที่พัฒนาหลังย้ายมา React มีเฉพาะบน `/next/` ได้แก่ การขายออฟไลน์และการ Sync, ราคาส่งสำหรับลูกค้าร้านค้า และเงินทอนตั้งต้นประจำวัน หากเปิดใช้งานที่ `/` จะยังไม่ได้ฟีเจอร์เหล่านี้

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
python backend/init_db.py
```

หากไม่กำหนด `DATABASE_URL` ระบบจะใช้ไฟล์ SQLite `pos.db` ในโฟลเดอร์โปรเจกต์โดยอัตโนมัติ

### 6. เปิดเซิร์ฟเวอร์

```powershell
python backend/server.py
```

เปิดเว็บที่ [http://localhost:8000](http://localhost:8000) และเข้าสู่ระบบด้วยค่าที่ตั้งไว้ใน `POS_PIN`

เมื่อแก้ Environment Variables ต้องหยุดเซิร์ฟเวอร์ด้วย `Ctrl + C` แล้วเปิดใหม่

ที่ขั้นตอนนี้จะใช้ได้เฉพาะแอปเดิมที่ `/` ส่วน `/next/` ต้อง Build ก่อนตามขั้นตอนถัดไป

### 7. Build แอป React

```powershell
npm --prefix frontend ci
npm --prefix frontend run build
```

จากนั้นเปิด [http://localhost:8000/next/](http://localhost:8000/next/) ได้เลย ต้อง Build ใหม่ทุกครั้งที่แก้โค้ดใน `frontend/src`

### 8. โหมดพัฒนา Frontend

ระหว่างพัฒนาไม่ต้อง Build ซ้ำทุกครั้ง ให้เปิด Flask ทิ้งไว้ที่ port 8000 แล้วเปิด Vite dev server อีกหน้าต่างหนึ่ง (Vite จะ proxy `/api` ไปให้ Flask เอง):

```powershell
npm --prefix frontend run dev
```

## Environment Variables

| ตัวแปร | จำเป็น | คำอธิบาย |
|---|---:|---|
| `POS_PIN` | ใช่ | PIN กลางสำหรับเข้าสู่ระบบ |
| `SECRET_KEY` | ใช่ | Secret สำหรับเข้ารหัส Flask session |
| `PROMPTPAY_ID` | ไม่ | เบอร์โทรศัพท์หรือเลขประจำตัว 13 หลักสำหรับสร้าง QR พร้อมเพย์ทั้ง Cloud Mode และ provisioning สำหรับ Local Mode |
| `SESSION_MINUTES` | ไม่ | อายุ session เป็นนาที ค่าเริ่มต้น 480 นาที |
| `DATABASE_URL` | ไม่ | PostgreSQL connection string หากไม่ตั้งจะใช้ SQLite |
| `SQLITE_PATH` | ไม่ | ตำแหน่งไฟล์ SQLite ที่ต้องการใช้แทน `pos.db` |

ตัวอย่างสำหรับ Local Development:

```powershell
$env:POS_PIN="1234"
$env:SECRET_KEY="replace-with-a-long-random-secret"
$env:PROMPTPAY_ID="0801234567"
$env:SESSION_MINUTES="480"
python backend/server.py
```

> QR พร้อมเพย์ฝังยอดชำระตามออเดอร์ แต่การรับเงินยังเป็นการยืนยันด้วยพนักงาน ไม่มีการตรวจสอบธนาคารหรือ payment gateway อัตโนมัติ

## การใช้ PostgreSQL หรือ Supabase

กำหนด `DATABASE_URL` ก่อนสร้าง schema และเปิดเซิร์ฟเวอร์:

```powershell
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE"
python backend/init_db.py
python backend/server.py
```

ตรวจสอบการเชื่อมต่อด้วย:

```powershell
python backend/verify_supabase.py
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

### Backend

รันเทสต์ทั้งหมด:

```powershell
cd backend
python -m unittest discover -s tests
```

เทสต์ต้องรันจากโฟลเดอร์ `backend` เพราะแต่ละไฟล์ `import database` และ `import server` โดยตรง

ตรวจ syntax:

```powershell
python -m compileall -q backend
```

### Frontend

```powershell
npm --prefix frontend run test        # Vitest + Testing Library
npm --prefix frontend run typecheck   # TypeScript
npm --prefix frontend run test:e2e    # Playwright (เปิด Flask และ Vite ให้เอง)
npm --prefix frontend run test:pwa    # ทดสอบโหมดออฟไลน์บน Production Build
```

Playwright จะสร้างฐานข้อมูล SQLite ของตัวเองใน `frontend/.playwright/` และปฏิเสธที่จะรันหากตั้ง `DATABASE_URL` ไว้ เพื่อไม่ให้เทสต์แตะฐานข้อมูลจริง

ตรวจ syntax ของแอปเดิม:

```powershell
node --check public/app.js
```

### ระบบโดยรวม

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
- ปุ่มพักออเดอร์ยังไม่ได้บันทึกออเดอร์ไว้จริง
- ยังไม่มีระบบพิมพ์ใบเสร็จ และค้นหาออเดอร์ข้ามวันไม่ได้ (ดูออเดอร์รายใบตามวันที่ที่เลือกได้แล้ว)
- ออเดอร์ออฟไลน์ที่ Sync แล้วแต่สต็อกบนเซิร์ฟเวอร์ไม่พอ ระบบจะบันทึกออเดอร์ให้และตัดสต็อกเหลือ 0 แล้วแจ้งให้ตรวจนับ ต้องมีคนยืนยันยอดจริงในหน้าจัดการสต็อก

## การอนุญาตขายออฟไลน์บน React PWA

หลัง Flask ยืนยัน session ออนไลน์สำเร็จ แอปจะบันทึกเครื่องหมาย trusted-device ใน IndexedDB เป็นเวลา 7 วัน (`enabledAt`, `expiresAt`, `schemaVersion`) และ provision ข้อมูลผู้รับ PromptPay ขั้นต่ำจาก API ที่ต้องยืนยันตัวตน โดยไม่เก็บ PIN, hash ของ PIN, `SECRET_KEY` หรือ session cookie เอง เมื่อหมดอายุ ต้องเชื่อมต่ออินเทอร์เน็ตและเข้าสู่ระบบสำเร็จอีกครั้งก่อนขายออฟไลน์

หากยังมีออเดอร์ออฟไลน์ที่รอ Sync แอปจะคงอยู่ใน Local Mode แม้อินเทอร์เน็ตกลับมาแล้ว ทั้งการขายเงินสดและ PromptPay ถัดไปจะบันทึกใน IndexedDB ต่อเนื่อง โดย PromptPay จะสร้าง payload และ QR ในเบราว์เซอร์โดยไม่เรียก API เพื่อไม่ให้สต็อกในเครื่องและเซิร์ฟเวอร์กลายเป็นสองแหล่งข้อมูลก่อนการ Sync

ข้อมูลผู้รับ PromptPay ที่ provision ไว้ประกอบด้วยเฉพาะ merchant-account information ที่ normalize แล้ว, เวอร์ชัน และเวลาที่ provision โดยเก็บใน IndexedDB store `offlinePaymentConfig` เท่านั้น ไม่เก็บใน localStorage, CacheStorage, source code หรือ public environment ข้อมูลผู้รับนี้จำเป็นต่อการสร้าง QR ออฟไลน์และถูกเข้ารหัสอยู่ใน QR ตามธรรมชาติ จึงไม่ใช่รหัสผ่านหรือ secret แต่ยังควรถือเป็นข้อมูลการชำระเงินประจำเครื่องและไม่ควร log หรือแสดงโดยไม่จำเป็น

ข้อแลกเปลี่ยนด้านความปลอดภัยคือ ผู้ที่เข้าถึง iPad ซึ่งได้รับอนุญาตแล้วทางกายภาพสามารถใช้ POS แบบออฟไลน์ได้จนกว่าเครื่องหมายนี้จะหมดอายุ จึงควรใช้รหัสล็อกอุปกรณ์ จำกัดผู้เข้าถึง และดูแล iPad เหมือนเครื่อง POS จริง

## ความปลอดภัย

- ห้าม commit ค่า `POS_PIN`, `SECRET_KEY` หรือ `DATABASE_URL` จริงลง repository
- ใช้ `SECRET_KEY` ที่ยาวและสุ่มสำหรับ Production
- เปลี่ยน PIN เมื่อมีบุคคลที่ไม่เกี่ยวข้องทราบค่า
- จำกัดสิทธิ์การเข้าถึงฐานข้อมูลและสำรองข้อมูลเป็นประจำ

