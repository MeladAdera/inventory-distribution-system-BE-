ALTER TABLE products
  ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Unique barcode per shop — only enforced when barcode is provided (NULLs are exempt)
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_shop_unique
  ON products(shop_id, barcode)
  WHERE barcode IS NOT NULL;
