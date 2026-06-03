-- Create inventory table
CREATE TABLE inventory (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  current_quantity INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_inventory_shop_id ON inventory(shop_id);
CREATE INDEX idx_inventory_product_id ON inventory(product_id);
CREATE UNIQUE INDEX idx_inventory_shop_product ON inventory(shop_id, product_id);
