import * as pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV || 'development'}` });

const client = new pg.Client({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  user: process.env.DATABASE_USERNAME || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'postgres',
  database: process.env.DATABASE_NAME || 'inventory_db_dev',
});

// Pre-hashed passwords (bcrypt, cost 10):
//   Admin@123    → WAREHOUSE_ADMIN
//   Owner@123    → SHOP_OWNERs
//   Employee@123 → EMPLOYEEs
const HASH_ADMIN = '$2b$10$WvxwrLL61hRVxOCK3n8iFuTPKdgQz6hmq/DhMoW/Cxatnf3XIS.Zq';
const HASH_OWNER = '$2b$10$W300Jw8Bt2h4Ox.LhE.gzesaXIc0bWNcwrLN9udiy4ePQbvFhcS7y';
const HASH_EMPLOYEE = '$2b$10$tnGHyhNmKBaBTlTpeW/xN.T6l13Ca.WTPUt4jc4PEOMTlimJ6G.FC';

async function clearData(): Promise<void> {
  // Order matters: children before parents
  await client.query('DELETE FROM refresh_tokens');
  await client.query('DELETE FROM audit_logs');
  await client.query('DELETE FROM notifications');
  await client.query('DELETE FROM order_items');
  await client.query('DELETE FROM orders');
  await client.query('DELETE FROM inventory');
  await client.query('DELETE FROM products');
  await client.query('DELETE FROM categories');
  await client.query('DELETE FROM users');
  await client.query('DELETE FROM shops');

  // Reset sequences so IDs start from 1
  for (const seq of [
    'shops_id_seq', 'users_id_seq', 'categories_id_seq', 'products_id_seq',
    'inventory_id_seq', 'orders_id_seq', 'order_items_id_seq',
    'notifications_id_seq', 'audit_logs_id_seq', 'refresh_tokens_id_seq',
  ]) {
    await client.query(`ALTER SEQUENCE ${seq} RESTART WITH 1`);
  }
}

async function seedShops(): Promise<void> {
  await client.query(`
    INSERT INTO shops (id, name, address, phone, type) VALUES
      (1, 'Main Warehouse',  'Industrial Zone, Block 1',  '+1-555-0100', 'WAREHOUSE'),
      (2, 'Downtown Shop',   '123 Main St, City Center',  '+1-555-0201', 'SHOP'),
      (3, 'Uptown Shop',     '456 North Ave, Uptown',     '+1-555-0202', 'SHOP'),
      (4, 'Eastside Branch', '789 East Rd, East District','+1-555-0203', 'SHOP')
  `);
  await client.query(`SELECT setval('shops_id_seq', 4)`);
}

async function seedUsers(): Promise<void> {
  await client.query(`
    INSERT INTO users (id, shop_id, name, email, password_hash, role, is_active) VALUES
      -- Warehouse admin (linked to warehouse shop)
      (1, 1, 'Warehouse Admin',  'admin@warehouse.com',   '${HASH_ADMIN}',    'WAREHOUSE_ADMIN', TRUE),

      -- Shop owners
      (2, 2, 'Alice Johnson',    'alice@downtown.com',    '${HASH_OWNER}',    'SHOP_OWNER',      TRUE),
      (3, 3, 'Bob Martinez',     'bob@uptown.com',        '${HASH_OWNER}',    'SHOP_OWNER',      TRUE),
      (4, 4, 'Carol Williams',   'carol@eastside.com',    '${HASH_OWNER}',    'SHOP_OWNER',      TRUE),

      -- Employees of Downtown Shop (shop_id = 2)
      (5, 2, 'David Lee',        'david@downtown.com',    '${HASH_EMPLOYEE}', 'EMPLOYEE',        TRUE),
      (6, 2, 'Eva Brown',        'eva@downtown.com',      '${HASH_EMPLOYEE}', 'EMPLOYEE',        TRUE),

      -- Employees of Uptown Shop (shop_id = 3)
      (7, 3, 'Frank Wilson',     'frank@uptown.com',      '${HASH_EMPLOYEE}', 'EMPLOYEE',        TRUE),

      -- Inactive user (to test filtering)
      (8, 2, 'Ghost Employee',   'ghost@downtown.com',    '${HASH_EMPLOYEE}', 'EMPLOYEE',        FALSE)
  `);
  await client.query(`SELECT setval('users_id_seq', 8)`);
}

async function seedCategories(): Promise<void> {
  await client.query(`
    INSERT INTO categories (id, shop_id, name) VALUES
      -- Warehouse categories (shop_id = 1)
      (1,  1, 'Electronics'),
      (2,  1, 'Beverages'),
      (3,  1, 'Snacks & Food'),
      (4,  1, 'Cleaning Supplies'),
      (5,  1, 'Personal Care'),

      -- Downtown Shop categories (shop_id = 2)
      (6,  2, 'Electronics'),
      (7,  2, 'Drinks'),
      (8,  2, 'Snacks'),

      -- Uptown Shop categories (shop_id = 3)
      (9,  3, 'Tech Accessories'),
      (10, 3, 'Groceries')
  `);
  await client.query(`SELECT setval('categories_id_seq', 10)`);
}

async function seedProducts(): Promise<void> {
  await client.query(`
    INSERT INTO products (id, shop_id, category_id, name, description, barcode, price, is_global, source, is_active) VALUES
      -- Warehouse global products (is_global = TRUE, source = 'WAREHOUSE')
      (1,  1, 1, 'USB-C Hub 7-Port',      '7-port USB-C hub with 4K HDMI',      'WH-ELEC-001', 45.99,  TRUE, 'WAREHOUSE', TRUE),
      (2,  1, 1, 'Wireless Mouse',        'Ergonomic 2.4GHz wireless mouse',    'WH-ELEC-002', 24.99,  TRUE, 'WAREHOUSE', TRUE),
      (3,  1, 1, 'Mechanical Keyboard',   'TKL mechanical keyboard, blue switch','WH-ELEC-003', 89.99,  TRUE, 'WAREHOUSE', TRUE),
      (4,  1, 1, 'Monitor Stand',         'Adjustable aluminum monitor stand',  'WH-ELEC-004', 34.99,  TRUE, 'WAREHOUSE', TRUE),
      (5,  1, 2, 'Water Bottle 500ml',    'Still mineral water, 500ml',         'WH-BEV-001',   0.99,  TRUE, 'WAREHOUSE', TRUE),
      (6,  1, 2, 'Orange Juice 1L',       'Fresh-squeezed orange juice 1L',     'WH-BEV-002',   2.49,  TRUE, 'WAREHOUSE', TRUE),
      (7,  1, 2, 'Energy Drink 250ml',    'Caffeinated energy drink 250ml',     'WH-BEV-003',   1.99,  TRUE, 'WAREHOUSE', TRUE),
      (8,  1, 3, 'Potato Chips 150g',     'Salted potato chips family pack',    'WH-SNK-001',   1.49,  TRUE, 'WAREHOUSE', TRUE),
      (9,  1, 3, 'Chocolate Bar 100g',    'Milk chocolate bar',                 'WH-SNK-002',   1.29,  TRUE, 'WAREHOUSE', TRUE),
      (10, 1, 4, 'All-Purpose Cleaner',   '1L multi-surface spray cleaner',     'WH-CLN-001',   3.99,  TRUE, 'WAREHOUSE', TRUE),
      (11, 1, 5, 'Hand Sanitizer 500ml',  'Alcohol-based hand sanitizer',       'WH-PER-001',   4.99,  TRUE, 'WAREHOUSE', TRUE),

      -- Downtown Shop local products (source = 'LOCAL')
      (12, 2, 6, 'Phone Case iPhone 15',  'Protective silicone case',           'DT-LOC-001',  12.99, FALSE, 'LOCAL',     TRUE),
      (13, 2, 8, 'Granola Bar',           'Oat and honey granola bar',          'DT-LOC-002',   2.29, FALSE, 'LOCAL',     TRUE),

      -- Uptown Shop local products
      (14, 3, 9, 'Cable Organizer',       'Silicone cable management clips',    'UT-LOC-001',   7.49, FALSE, 'LOCAL',     TRUE),

      -- Inactive product (to test filtering)
      (15, 1, 1, 'Old USB Hub (disc.)',   'Discontinued product',               NULL,            0.00,  TRUE, 'WAREHOUSE', FALSE)
  `);
  await client.query(`SELECT setval('products_id_seq', 15)`);
}

async function seedInventory(): Promise<void> {
  // (shop_id, product_id, current_quantity, low_stock_threshold)
  await client.query(`
    INSERT INTO inventory (shop_id, product_id, current_quantity, low_stock_threshold) VALUES
      -- Warehouse stock (shop_id = 1)
      (1, 1,  200, 20),
      (1, 2,  500, 50),
      (1, 3,  150, 15),
      (1, 4,  300, 30),
      (1, 5, 2000, 200),
      (1, 6,  800, 80),
      (1, 7,  600, 60),
      (1, 8, 1000, 100),
      (1, 9, 1200, 100),
      (1, 10,  400, 40),
      (1, 11,  350, 35),

      -- Downtown Shop stock (shop_id = 2)
      (2, 1,   15, 10),  -- below threshold → triggers low-stock notification
      (2, 2,   40, 20),
      (2, 3,   25, 15),
      (2, 5,  120, 30),
      (2, 6,   60, 20),
      (2, 7,    5, 15),  -- critically low
      (2, 8,   80, 25),
      (2, 9,   90, 25),
      (2, 12,  35, 10),
      (2, 13,  50, 15),

      -- Uptown Shop stock (shop_id = 3)
      (3, 1,   20, 10),
      (3, 2,   55, 20),
      (3, 4,   18, 10),
      (3, 5,  200, 50),
      (3, 6,   45, 20),
      (3, 9,   70, 25),
      (3, 14,  30, 10),

      -- Eastside Branch stock (shop_id = 4)
      (4, 2,   30, 20),
      (4, 3,   12, 15),
      (4, 5,   80, 30),
      (4, 8,   45, 25),
      (4, 10,  22, 15),
      (4, 11,   9, 15)   -- below threshold
  `);
}

async function seedOrders(): Promise<void> {
  // Orders: warehouse (1) → shops  OR  shop → warehouse
  await client.query(`
    INSERT INTO orders (id, from_shop_id, to_shop_id, status, total_items, created_at) VALUES
      -- Completed orders (Downtown receiving from Warehouse)
      (1, 1, 2, 'COMPLETED',   3, NOW() - INTERVAL '10 days'),
      (2, 1, 2, 'COMPLETED',   5, NOW() - INTERVAL '7 days'),
      -- Completed order (Uptown)
      (3, 1, 3, 'COMPLETED',   2, NOW() - INTERVAL '5 days'),
      -- In-flight orders
      (4, 1, 2, 'SHIPPED',     4, NOW() - INTERVAL '2 days'),
      (5, 1, 3, 'PROCESSING',  3, NOW() - INTERVAL '1 day'),
      -- Pending orders
      (6, 1, 4, 'PENDING',     6, NOW() - INTERVAL '3 hours'),
      (7, 1, 2, 'PENDING',     2, NOW() - INTERVAL '1 hour')
  `);
  await client.query(`SELECT setval('orders_id_seq', 7)`);

  await client.query(`
    INSERT INTO order_items (order_id, product_id, quantity, price) VALUES
      -- Order 1
      (1, 2,  20, 24.99),
      (1, 5, 100,  0.99),
      (1, 8,  50,  1.49),

      -- Order 2
      (2, 1,  10, 45.99),
      (2, 3,   5, 89.99),
      (2, 6,  30,  2.49),
      (2, 9,  60,  1.29),
      (2, 10, 20,  3.99),

      -- Order 3
      (3, 2,  30, 24.99),
      (3, 4,  15, 34.99),

      -- Order 4 (SHIPPED)
      (4, 1,   5, 45.99),
      (4, 2,  25, 24.99),
      (4, 7,  40,  1.99),
      (4, 9,  50,  1.29),

      -- Order 5 (PROCESSING)
      (5, 3,  10, 89.99),
      (5, 5, 200,  0.99),
      (5, 11, 30,  4.99),

      -- Order 6 (PENDING)
      (6, 2,  20, 24.99),
      (6, 5, 150,  0.99),
      (6, 6,  40,  2.49),
      (6, 8,  80,  1.49),
      (6, 9,  60,  1.29),
      (6, 10, 30,  3.99),

      -- Order 7 (PENDING)
      (7, 1,   3, 45.99),
      (7, 3,   2, 89.99)
  `);
}

async function seedNotifications(): Promise<void> {
  await client.query(`
    INSERT INTO notifications (shop_id, user_id, title, message, type, is_read) VALUES
      (2, 2, 'Low Stock Alert',      'USB-C Hub 7-Port is running low (15 units). Reorder soon.', 'LOW_STOCK',    FALSE),
      (2, 2, 'Low Stock Alert',      'Energy Drink 250ml is critically low (5 units).',            'LOW_STOCK',    FALSE),
      (4, 4, 'Low Stock Alert',      'Hand Sanitizer 500ml is below threshold (9 units).',         'LOW_STOCK',    FALSE),
      (2, 2, 'Order Shipped',        'Order #4 from Main Warehouse is on its way.',                'ORDER_UPDATE', FALSE),
      (3, 3, 'Order Processing',     'Order #5 is being processed at the warehouse.',              'ORDER_UPDATE', FALSE),
      (2, 2, 'Order Completed',      'Order #1 has been delivered and marked complete.',           'ORDER_UPDATE', TRUE),
      (2, 2, 'Welcome to the system','Your shop Downtown Shop is now active.',                     'SYSTEM',       TRUE),
      (3, 3, 'Welcome to the system','Your shop Uptown Shop is now active.',                       'SYSTEM',       TRUE),
      (4, 4, 'Welcome to the system','Your shop Eastside Branch is now active.',                   'SYSTEM',       TRUE)
  `);
}

async function seedAuditLogs(): Promise<void> {
  await client.query(`
    INSERT INTO audit_logs (shop_id, user_id, type, action, entity_type, entity_id, quantity, amount, notes) VALUES
      -- Inventory movements
      (1, 1, 'INVENTORY', 'STOCK_IN',  'PRODUCT',  1,  200, NULL, 'Initial stock — USB-C Hub'),
      (1, 1, 'INVENTORY', 'STOCK_IN',  'PRODUCT',  2,  500, NULL, 'Initial stock — Wireless Mouse'),
      (2, 2, 'INVENTORY', 'ADJUST',    'PRODUCT',  7,  -10, NULL, 'Damaged goods removed — Energy Drink'),
      (4, 4, 'INVENTORY', 'ADJUST',    'PRODUCT', 11,   -5, NULL, 'Expired units removed — Hand Sanitizer'),

      -- Order events
      (2, 2, 'ORDER', 'CREATED',   'ORDER', 1, NULL, NULL,    'Requested stock replenishment'),
      (1, 1, 'ORDER', 'SHIPPED',   'ORDER', 1, NULL, NULL,    'Dispatched from warehouse'),
      (2, 2, 'ORDER', 'RECEIVED',  'ORDER', 1, NULL, NULL,    'Stock received at Downtown Shop'),
      (2, 2, 'ORDER', 'COMPLETED', 'ORDER', 1, NULL, 2572.50, 'Order closed'),

      -- User management
      (2, 1, 'USER', 'CREATED', 'USER', 5, NULL, NULL, 'Employee David Lee added to Downtown Shop'),
      (2, 1, 'USER', 'CREATED', 'USER', 6, NULL, NULL, 'Employee Eva Brown added to Downtown Shop'),
      (2, 1, 'USER', 'CREATED', 'USER', 7, NULL, NULL, 'Employee Frank Wilson added to Uptown Shop'),

      -- Product events
      (1, 1, 'PRODUCT', 'CREATED', 'PRODUCT', 15, NULL, NULL, 'Product added then discontinued'),
      (1, 1, 'PRODUCT', 'DELETED', 'PRODUCT', 15, NULL, NULL, 'Product soft-deleted (discontinued)')
  `);
}

async function run(): Promise<void> {
  try {
    await client.connect();
    console.log('Connected to database');

    console.log('Clearing existing data…');
    await clearData();

    console.log('Seeding shops…');
    await seedShops();

    console.log('Seeding users…');
    await seedUsers();

    console.log('Seeding categories…');
    await seedCategories();

    console.log('Seeding products…');
    await seedProducts();

    console.log('Seeding inventory…');
    await seedInventory();

    console.log('Seeding orders…');
    await seedOrders();

    console.log('Seeding notifications…');
    await seedNotifications();

    console.log('Seeding audit logs…');
    await seedAuditLogs();

    console.log('\n✓ Seed complete. Test credentials:');
    console.log('  admin@warehouse.com   / Admin@123    (WAREHOUSE_ADMIN)');
    console.log('  alice@downtown.com    / Owner@123    (SHOP_OWNER  — Downtown Shop)');
    console.log('  bob@uptown.com        / Owner@123    (SHOP_OWNER  — Uptown Shop)');
    console.log('  carol@eastside.com    / Owner@123    (SHOP_OWNER  — Eastside Branch)');
    console.log('  david@downtown.com    / Employee@123 (EMPLOYEE    — Downtown Shop)');
    console.log('  eva@downtown.com      / Employee@123 (EMPLOYEE    — Downtown Shop)');
    console.log('  frank@uptown.com      / Employee@123 (EMPLOYEE    — Uptown Shop)');
    console.log('  ghost@downtown.com    / Employee@123 (EMPLOYEE    — inactive)');
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  void run();
}

export { run };
