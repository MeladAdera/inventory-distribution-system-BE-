-- ============================================================
-- 03 — Free a soft-deleted product's barcode for reuse
-- ============================================================
-- The per-shop barcode uniqueness index ignored is_active, so a soft-deleted
-- product kept its (shop_id, barcode) slot occupied. The app-level duplicate
-- check (findByBarcodeAndShop) filters is_active = TRUE, so it would pass for a
-- barcode that only a soft-deleted product still held — and then the INSERT hit
-- this index and failed with a raw 500 instead of being allowed (or a clean
-- 409). Scoping the index to active products lines it up with the app check:
-- deleting a product now releases its barcode for reuse.

DROP INDEX IF EXISTS idx_products_barcode_shop_unique;

CREATE UNIQUE INDEX idx_products_barcode_shop_unique
  ON products(shop_id, barcode)
  WHERE barcode IS NOT NULL AND is_active = TRUE;
