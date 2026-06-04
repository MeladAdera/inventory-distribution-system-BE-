-- The WAREHOUSE_ADMIN was seeded with shop_id = NULL.
-- The warehouse shop (type = 'WAREHOUSE') already exists as the first seeded shop.
-- Linking them allows the admin to own warehouse-level categories and products.
UPDATE users
SET shop_id = (SELECT id FROM shops WHERE type = 'WAREHOUSE' LIMIT 1)
WHERE role = 'WAREHOUSE_ADMIN';
