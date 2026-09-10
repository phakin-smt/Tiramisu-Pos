PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    -- Automatic pricing, per store. A NULL trigger switches the rule off, which
    -- is how a new store starts: manual discounts only until someone decides
    -- what its promotions should be.
    bundle_unit_price REAL,
    bundle_quantity INTEGER,
    bundle_price REAL,
    wholesale_category TEXT,
    wholesale_discount REAL,
    -- Served from public/logos. NULL falls back to the store initials.
    logo_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- store_id defaults to the first store so that every statement written before
-- multi-store support keeps inserting valid rows without being rewritten.
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL DEFAULT 1 REFERENCES stores(id),
    sku TEXT NOT NULL,
    barcode TEXT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    cost_price REAL DEFAULT 0 CHECK (cost_price >= 0),
    stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
    stock_min INTEGER NOT NULL DEFAULT 0 CHECK (stock_min >= 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (store_id, sku)
);

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_code TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    customer_type TEXT NOT NULL DEFAULT 'walkin',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL DEFAULT 1 REFERENCES stores(id),
    order_number TEXT NOT NULL,
    -- Stays globally unique: the key is a client-generated UUID, and offline
    -- replay relies on one key naming one sale across the whole system.
    idempotency_key TEXT UNIQUE,
    order_date TEXT NOT NULL DEFAULT (date('now')),
    customer_id INTEGER,
    payment_method TEXT NOT NULL,
    subtotal REAL NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
    vat REAL NOT NULL DEFAULT 0 CHECK (vat >= 0),
    total REAL NOT NULL DEFAULT 0 CHECK (total >= 0),
    status TEXT NOT NULL DEFAULT 'completed',
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    UNIQUE (store_id, order_number)
);

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    giveaway_qty INTEGER NOT NULL DEFAULT 0 CHECK (giveaway_qty >= 0 AND giveaway_qty <= quantity),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
    line_total REAL NOT NULL CHECK (line_total >= 0),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    paid_amount REAL NOT NULL CHECK (paid_amount >= 0),
    change_amount REAL NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
    payment_reference TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL DEFAULT 1 REFERENCES stores(id),
    product_id INTEGER NOT NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('sale', 'stock_in', 'stock_out', 'adjust')),
    quantity INTEGER NOT NULL CHECK (quantity != 0),
    reference_type TEXT,
    reference_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS daily_closures (
    store_id INTEGER NOT NULL DEFAULT 1 REFERENCES stores(id),
    report_date TEXT NOT NULL,
    closed_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (store_id, report_date)
);

CREATE TABLE IF NOT EXISTS cash_days (
    store_id INTEGER NOT NULL DEFAULT 1 REFERENCES stores(id),
    report_date TEXT NOT NULL,
    opening_float REAL NOT NULL CHECK (opening_float >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (store_id, report_date)
);

CREATE TABLE IF NOT EXISTS stock_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL DEFAULT 1 REFERENCES stores(id),
    product_id INTEGER NOT NULL,
    plan_date TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'cancelled')),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    applied_at TEXT,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- One picture per menu item, kept out of products so that the many queries
-- reading a product's price or stock never drag its image bytes along. Bytes
-- rather than a file path: the deployment's filesystem is read-only, and a
-- single database keeps one backup covering everything.
CREATE TABLE IF NOT EXISTS product_images (
    product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size > 0),
    -- Names this picture's bytes. It versions the URL and doubles as the ETag,
    -- so replacing an image always changes its address -- which a timestamp
    -- resolved to the second could not promise.
    checksum TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The QR a shop is paid through, when it would rather show its own than have one
-- generated from a PromptPay id. Bytes here for the same reason menu pictures
-- are: the deployment's filesystem is read-only and one database is the whole
-- backup. A shop with no row here falls back to the deployment-wide
-- PROMPTPAY_ID, which is the only path that can still carry the amount.
CREATE TABLE IF NOT EXISTS store_payment_qr (
    store_id INTEGER PRIMARY KEY REFERENCES stores(id),
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size > 0),
    -- Names these exact bytes, so a replaced QR arrives at a new address and a
    -- till never scans a cached copy of the QR it used yesterday.
    checksum TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_stock_plans_date ON stock_plans(plan_date);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
