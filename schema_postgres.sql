CREATE TABLE IF NOT EXISTS products (
 id BIGSERIAL PRIMARY KEY, sku TEXT UNIQUE NOT NULL, barcode TEXT, name TEXT NOT NULL,
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
CREATE TABLE IF NOT EXISTS orders (
 id BIGSERIAL PRIMARY KEY, order_number TEXT UNIQUE NOT NULL, idempotency_key TEXT UNIQUE,
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
 id BIGSERIAL PRIMARY KEY, product_id BIGINT NOT NULL REFERENCES products(id),
 movement_type TEXT NOT NULL CHECK (movement_type IN ('sale','stock_in','stock_out','adjust')),
 quantity INTEGER NOT NULL CHECK (quantity <> 0), reference_type TEXT, reference_id TEXT, note TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS daily_closures (
 report_date DATE PRIMARY KEY, closed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS stock_plans (
 id BIGSERIAL PRIMARY KEY, product_id BIGINT NOT NULL REFERENCES products(id),
 plan_date DATE NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','cancelled')),
 note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, applied_at TIMESTAMPTZ
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_plans_date ON stock_plans(plan_date);
