-- Create categories table
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create products table
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  barcode VARCHAR(100),
  is_global BOOLEAN DEFAULT FALSE,
  source VARCHAR(50) CHECK (source IN ('WAREHOUSE', 'LOCAL')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_categories_shop_id ON categories(shop_id);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_shop_id ON products(shop_id);
CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_products_source ON products(source);
