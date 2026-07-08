-- ============================================================
-- Complete schema — single source of truth (squashed)
-- ============================================================

-- SHOPS
CREATE TABLE shops (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  address    VARCHAR(255) NOT NULL,
  phone      VARCHAR(20),
  type       VARCHAR(50)  NOT NULL DEFAULT 'SHOP' CHECK (type IN ('WAREHOUSE', 'SHOP')),
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

-- USERS
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  shop_id       INTEGER      REFERENCES shops(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(50)  NOT NULL CHECK (role IN ('WAREHOUSE_ADMIN', 'SHOP_OWNER', 'EMPLOYEE')),
  is_active     BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_shop_id ON users(shop_id);
CREATE INDEX idx_users_email   ON users(email);

-- CATEGORIES
CREATE TABLE categories (
  id         SERIAL PRIMARY KEY,
  shop_id    INTEGER      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  image_url  VARCHAR(500),
  created_at TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_categories_shop_id ON categories(shop_id);

-- PRODUCTS
-- cost_price is the current buying price, used alongside the selling price
-- for profit tracking; order_items/receipt_items snapshot it at transaction
-- time so profit on historical transactions isn't distorted by later changes.
CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  category_id INTEGER         REFERENCES categories(id) ON DELETE SET NULL,
  shop_id     INTEGER         REFERENCES shops(id) ON DELETE CASCADE,
  name        VARCHAR(255)    NOT NULL,
  description TEXT,
  barcode     VARCHAR(100),
  price       DECIMAL(10, 2)  NOT NULL DEFAULT 0,
  cost_price  DECIMAL(10, 2)  NOT NULL DEFAULT 0,
  is_global   BOOLEAN         DEFAULT FALSE,
  source      VARCHAR(50)     CHECK (source IN ('WAREHOUSE', 'LOCAL')),
  image_url   VARCHAR(500),
  is_active   BOOLEAN         NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ     DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ     DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_shop_id     ON products(shop_id);
CREATE INDEX idx_products_barcode     ON products(barcode);
CREATE INDEX idx_products_source      ON products(source);
CREATE UNIQUE INDEX idx_products_barcode_shop_unique ON products(shop_id, barcode) WHERE barcode IS NOT NULL;

-- INVENTORY
CREATE TABLE inventory (
  id                  SERIAL PRIMARY KEY,
  shop_id             INTEGER NOT NULL REFERENCES shops(id)    ON DELETE CASCADE,
  product_id          INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  current_quantity    INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 10,
  updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX        idx_inventory_shop_id     ON inventory(shop_id);
CREATE INDEX        idx_inventory_product_id  ON inventory(product_id);
CREATE UNIQUE INDEX idx_inventory_shop_product ON inventory(shop_id, product_id);

-- ORDERS
CREATE TABLE orders (
  id           SERIAL PRIMARY KEY,
  from_shop_id INTEGER    REFERENCES shops(id) ON DELETE CASCADE,
  to_shop_id   INTEGER    REFERENCES shops(id) ON DELETE CASCADE,
  status       VARCHAR(50) NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING', 'PROCESSING', 'SHIPPED', 'RECEIVED', 'COMPLETED', 'CANCELLED')),
  total_items  INTEGER,
  created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_from_shop_id ON orders(from_shop_id);
CREATE INDEX idx_orders_to_shop_id   ON orders(to_shop_id);
CREATE INDEX idx_orders_status       ON orders(status);

-- ORDER ITEMS
-- price/cost_price are snapshots taken at order time (not live product lookups).
CREATE TABLE order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER        NOT NULL REFERENCES orders(id)   ON DELETE CASCADE,
  product_id INTEGER        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity   INTEGER        NOT NULL,
  price      DECIMAL(15, 2) NOT NULL,
  cost_price DECIMAL(15, 2) NOT NULL DEFAULT 0
);

CREATE INDEX idx_order_items_order_id   ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);

-- RECEIPTS
-- is_free: customer wasn't charged. Inventory still gets deducted at cost,
-- but a free receipt's revenue is excluded from shop profit reports (see
-- getShopProfitSummary/getShopProfitTrend) — cost still counts, so it shows
-- up as a straight loss rather than being dropped from totals entirely.
CREATE TABLE receipts (
  id         SERIAL PRIMARY KEY,
  shop_id    INTEGER NOT NULL REFERENCES shops(id)  ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  notes      TEXT,
  is_free    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_receipts_shop_created ON receipts(shop_id, created_at DESC);
CREATE INDEX idx_receipts_created_by  ON receipts(created_by);

-- RECEIPT ITEMS
-- price/cost_price mirror the order_items snapshot pattern.
CREATE TABLE receipt_items (
  id              SERIAL PRIMARY KEY,
  receipt_id      INTEGER NOT NULL REFERENCES receipts(id)   ON DELETE CASCADE,
  inventory_id    INTEGER NOT NULL REFERENCES inventory(id)  ON DELETE CASCADE,
  product_id      INTEGER NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  quantity_before INTEGER NOT NULL,
  quantity_after  INTEGER NOT NULL CHECK (quantity_after >= 0),
  price           DECIMAL(15, 2) NOT NULL,
  cost_price      DECIMAL(15, 2) NOT NULL DEFAULT 0
);

CREATE INDEX idx_receipt_items_receipt_id   ON receipt_items(receipt_id);
CREATE INDEX idx_receipt_items_inventory_id ON receipt_items(inventory_id);

-- NOTIFICATIONS
CREATE TABLE notifications (
  id         SERIAL PRIMARY KEY,
  shop_id    INTEGER      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  title      VARCHAR(255) NOT NULL,
  message    TEXT,
  type       VARCHAR(50),
  args       JSONB        DEFAULT NULL,
  is_read    BOOLEAN      DEFAULT FALSE,
  created_at TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_shop_id ON notifications(shop_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);

-- AUDIT LOGS
-- receipt_id: structured back-reference to the receipt a log entry came from
-- (receipt creation's ADJUSTMENT entries, and MARKED_FREE/UNMARKED_FREE from
-- toggling a receipt's is_free flag) — null for everything else.
CREATE TABLE audit_logs (
  id          SERIAL PRIMARY KEY,
  shop_id     INTEGER        REFERENCES shops(id) ON DELETE CASCADE,
  user_id     INTEGER        REFERENCES users(id) ON DELETE SET NULL,
  type        VARCHAR(50),
  action      VARCHAR(50),
  entity_type VARCHAR(50),
  entity_id   INTEGER,
  receipt_id  INTEGER        REFERENCES receipts(id) ON DELETE SET NULL,
  quantity    INTEGER,
  amount      DECIMAL(15, 2),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_shop_id    ON audit_logs(shop_id);
CREATE INDEX idx_audit_logs_user_id    ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_type       ON audit_logs(type);
CREATE INDEX idx_audit_logs_action     ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity     ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_receipt_id ON audit_logs(receipt_id);

-- REFRESH TOKENS
CREATE TABLE refresh_tokens (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT         NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ  NULL
);

CREATE INDEX idx_refresh_tokens_user_id    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- ============================================================
-- SEEDS
-- ============================================================

-- Central warehouse shop (must exist before any user or product)
INSERT INTO shops (name, address, type)
VALUES ('Main Warehouse', 'Central Location', 'WAREHOUSE');

-- Warehouse admin account  (password: Admin@123)
INSERT INTO users (name, email, password_hash, role, shop_id)
VALUES (
  'Warehouse Admin',
  'admin@warehouse.com',
  '$2b$10$WvxwrLL61hRVxOCK3n8iFuTPKdgQz6hmq/DhMoW/Cxatnf3XIS.Zq',
  'WAREHOUSE_ADMIN',
  (SELECT id FROM shops WHERE type = 'WAREHOUSE' LIMIT 1)
);
