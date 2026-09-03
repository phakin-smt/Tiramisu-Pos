-- Automatic pricing lives per store. A NULL trigger switches the rule off, which
-- is how a new store starts: manual discounts only until someone decides what
-- its promotions should be.
CREATE TABLE IF NOT EXISTS stores (
 id BIGSERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
 bundle_unit_price NUMERIC(12,2), bundle_quantity INTEGER, bundle_price NUMERIC(12,2),
 wholesale_category TEXT, wholesale_discount NUMERIC(12,2),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- store_id defaults to the first store so that every statement written before
-- multi-store support keeps inserting valid rows without being rewritten.
CREATE TABLE IF NOT EXISTS products (
 id BIGSERIAL PRIMARY KEY, store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id), sku TEXT NOT NULL, barcode TEXT, name TEXT NOT NULL,
 category TEXT NOT NULL, unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
 cost_price NUMERIC(12,2) DEFAULT 0 CHECK (cost_price >= 0), stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
 stock_min INTEGER NOT NULL DEFAULT 0 CHECK (stock_min >= 0), is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
 image_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customers (
 id BIGSERIAL PRIMARY KEY, customer_code TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL, phone TEXT, email TEXT,
 customer_type TEXT NOT NULL DEFAULT 'walkin', is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- idempotency_key stays globally unique: it is a client-generated UUID, and
-- offline replay relies on one key naming one sale across the whole system.
CREATE TABLE IF NOT EXISTS orders (
 id BIGSERIAL PRIMARY KEY, store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id), order_number TEXT NOT NULL, idempotency_key TEXT UNIQUE,
 order_date DATE NOT NULL DEFAULT CURRENT_DATE, customer_id BIGINT REFERENCES customers(id), payment_method TEXT NOT NULL,
 subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0), discount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
 vat NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (vat >= 0), total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
 status TEXT NOT NULL DEFAULT 'completed', note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
 id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 product_id BIGINT NOT NULL REFERENCES products(id), product_name TEXT NOT NULL, sku TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK (quantity > 0), giveaway_qty INTEGER NOT NULL DEFAULT 0 CHECK (giveaway_qty >= 0 AND giveaway_qty <= quantity), unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
 discount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0), line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0)
);
CREATE TABLE IF NOT EXISTS payments (
 id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, payment_method TEXT NOT NULL,
 paid_amount NUMERIC(12,2) NOT NULL CHECK (paid_amount >= 0), change_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
 payment_reference TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS stock_movements (
 id BIGSERIAL PRIMARY KEY, store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id), product_id BIGINT NOT NULL REFERENCES products(id),
 movement_type TEXT NOT NULL CHECK (movement_type IN ('sale','stock_in','stock_out','adjust')),
 quantity INTEGER NOT NULL CHECK (quantity <> 0), reference_type TEXT, reference_id TEXT, note TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS daily_closures (
 store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id), report_date DATE NOT NULL,
 closed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (store_id, report_date)
);
CREATE TABLE IF NOT EXISTS cash_days (
 store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id), report_date DATE NOT NULL,
 opening_float NUMERIC(12,2) NOT NULL CHECK (opening_float >= 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (store_id, report_date)
);
CREATE TABLE IF NOT EXISTS stock_plans (
 id BIGSERIAL PRIMARY KEY, store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id), product_id BIGINT NOT NULL REFERENCES products(id),
 plan_date DATE NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','cancelled')),
 note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, applied_at TIMESTAMPTZ
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key);

-- Everything past this point brings a database created before multi-store
-- support up to the definitions above. Each statement is idempotent, because
-- init_schema() runs this file on every start.
INSERT INTO stores (id, code, name)
 SELECT 1, 'baannoi', 'Baannoi'
 WHERE NOT EXISTS (SELECT 1 FROM stores WHERE id = 1);
SELECT setval(pg_get_serial_sequence('stores', 'id'), GREATEST((SELECT MAX(id) FROM stores), 1));

ALTER TABLE stores ADD COLUMN IF NOT EXISTS bundle_unit_price NUMERIC(12,2);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS bundle_quantity INTEGER;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS bundle_price NUMERIC(12,2);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS wholesale_category TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS wholesale_discount NUMERIC(12,2);
-- The first store keeps the rules that were compiled into the application, so
-- nothing about its pricing changes.
UPDATE stores SET bundle_unit_price=69, bundle_quantity=3, bundle_price=200,
 wholesale_category='Tiramisu', wholesale_discount=9
 WHERE id=1 AND bundle_unit_price IS NULL AND wholesale_category IS NULL;

ALTER TABLE products ADD COLUMN IF NOT EXISTS store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id);
ALTER TABLE stock_plans ADD COLUMN IF NOT EXISTS store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id);
ALTER TABLE daily_closures ADD COLUMN IF NOT EXISTS store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id);
ALTER TABLE cash_days ADD COLUMN IF NOT EXISTS store_id BIGINT NOT NULL DEFAULT 1 REFERENCES stores(id);

-- A SKU and an order number only have to be unique within their own store.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_store_sku ON products(store_id, sku);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_store_number ON orders(store_id, order_number);

-- One shop closing its day, or setting its float, must not do so for the other.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
            WHERE c.relname = 'daily_closures' AND i.indisprimary AND i.indnatts = 1) THEN
  ALTER TABLE daily_closures DROP CONSTRAINT daily_closures_pkey;
  ALTER TABLE daily_closures ADD PRIMARY KEY (store_id, report_date);
 END IF;
 IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
            WHERE c.relname = 'cash_days' AND i.indisprimary AND i.indnatts = 1) THEN
  ALTER TABLE cash_days DROP CONSTRAINT cash_days_pkey;
  ALTER TABLE cash_days ADD PRIMARY KEY (store_id, report_date);
 END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_store_date ON orders(store_id, order_date);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_store ON stock_movements(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_plans_date ON stock_plans(plan_date);
