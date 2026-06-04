-- Seed the WAREHOUSE_ADMIN account (platform owner)
-- Password: Admin@123  (change via /users/shop-owners flow in production)
INSERT INTO users (name, email, password_hash, role, shop_id)
VALUES (
  'Warehouse Admin',
  'admin@warehouse.com',
  '$2b$10$WvxwrLL61hRVxOCK3n8iFuTPKdgQz6hmq/DhMoW/Cxatnf3XIS.Zq',
  'WAREHOUSE_ADMIN',
  NULL
);
