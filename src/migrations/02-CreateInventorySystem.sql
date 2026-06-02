-- Create inventory table
CREATE TABLE inventory (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  current_quantity INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create inventory_movements table
CREATE TABLE inventory_movements (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('IN', 'OUT', 'ADJUSTMENT', 'ORDER_RECEIVED', 'SALE', 'DAMAGE', 'EXPIRED')),
  quantity INTEGER NOT NULL,
  reference_type VARCHAR(50) CHECK (reference_type IN ('ORDER', 'MANUAL', 'SYSTEM')),
  reference_id INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_inventory_shop_id ON inventory(shop_id);
CREATE INDEX idx_inventory_product_id ON inventory(product_id);
CREATE UNIQUE INDEX idx_inventory_shop_product ON inventory(shop_id, product_id);
CREATE INDEX idx_inventory_movements_shop_id ON inventory_movements(shop_id);
CREATE INDEX idx_inventory_movements_product_id ON inventory_movements(product_id);
CREATE INDEX idx_inventory_movements_type ON inventory_movements(type);
CREATE INDEX idx_inventory_movements_created_by ON inventory_movements(created_by);
