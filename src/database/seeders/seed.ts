import * as pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV || 'development'}` });

const client = new pg.Client({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  user: process.env.DATABASE_USERNAME || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'postgres',
  database: process.env.DATABASE_NAME || 'inventory_db_dev',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Pre-hashed password (bcrypt, cost 10): Admin@123 → WAREHOUSE_ADMIN
const HASH_ADMIN = '$2b$10$WvxwrLL61hRVxOCK3n8iFuTPKdgQz6hmq/DhMoW/Cxatnf3XIS.Zq';

// ── Warehouse catalog ────────────────────────────────────────────────────────
// The single source of truth for the warehouse's global product catalog.
// Each category carries a Lucide icon name for the catalog UI. Products are
// created as global warehouse items (is_global = TRUE, source = 'WAREHOUSE');
// prices default to 0 and are filled in later per product.
interface CatalogCategory {
  name: string;
  icon: string;
  products: string[];
}

const CATALOG: CatalogCategory[] = [
  {
    name: 'دخان',
    icon: 'Cigarette',
    products: [
      'MB أحمر ورق', 'MB غولد ورق', 'MB أزرق كوين', 'WE فضي كوين', 'WE أزرق قصير',
      'جيتان قصير', 'كابتن بلاك فضي سليم', 'كابتن بلاك سكاي', 'كابتن ون كوين',
      'كابتن غولد', 'غلواز أصفر ك', 'غلواز أحمر ك', 'غلواز أحمر عريض',
      'غلواز أصفر عريض', 'MS قصير فضي', 'كوين أزرق', 'كوين أبيض', 'ون أبيض',
      'ون أزرق', 'طويل ورق', 'قصير أزرق', 'قصير فضي', 'قصير E فضي', 'طويل فضي',
      'سليم نعنع', 'طويل أسود', 'قصير أسود', 'سليم أزرق', 'طبعة جديدة', 'سيدرس',
      'ديفيدوف ذهبي', 'ديفيدوف أبيض', 'ديفيدوف أحمر', '1970 كوين أبيض',
      '1970 سليم فضي', '1970 قصير فضي', '1970 قصير أزرق', '1970 طويل فضي',
      '1970 طويل أزرق', '1970 سليم نعنع', 'كنت فضي', 'كنت أزرق', 'أوريس طقتين',
      'أوريس منغا', 'أوريس شوكولا', 'أوريس أزرق', 'دينفر كوين', 'مانشستر قصير',
      'برو فضي', 'برو أزرق', 'روز أزرق', 'روز فضي', 'اختمار سليم', 'أوسكار طويل',
      'ويلسون أحمر', 'يوناتيد', 'هيستوري أزرق', 'هيستوري فضي', 'TS طويل فضي',
      '1970 سليم أزرق', 'دينفر أصفر', 'الغانس شوكو', 'كابتن سيكار', 'اختمار قصير',
    ],
  },
  {
    name: 'مستلزمات أركيلة',
    icon: 'Flame',
    products: [
      'نخلة لبناني', 'نخلة صلاحية', 'كف لوف', 'كف مصري', 'فاخر أسود', 'مزايا فرنسي',
      'مزايا بولو', 'مزايا علكة', 'مزايا بحريني', 'مزايا لوف', 'مزايا عنب',
      'مزايا مصري', 'سولفان', 'فحم الزعيم 1 كغ', 'فحم الزعيم 1/2 كغ',
      'فحم الزعيم 1/4 كغ',
    ],
  },
  {
    name: 'مشروبات باردة',
    icon: 'CupSoda',
    products: [
      'كروز', 'تيبورغ أحمر', 'تيبورغ أخضر', 'XXL صغيرة', 'XXL كبيرة',
      'مشروب غازي تنك', 'كينزا تنك', 'سلس', 'بايسون صغيرة', 'بايسون كبيرة',
      'كولا لتر', 'كولا صغيرة', 'كولا تنك', 'طاقة جاك', 'أبس كوفي', 'ريد بول',
      'بانسيلا', 'ماء كبيرة', 'ماء صغيرة',
    ],
  },
  {
    name: 'مشروبات ساخنة',
    icon: 'Coffee',
    products: [
      'ظرف شاي', '3 ب 1', '2 ب 1', 'سيتي كافي ظرف', 'إسبريسو', 'إسبريسو دبل',
      'نسكافيه عادي', 'نسكافيه دبل', 'ميلو', 'شاي زهورات',
    ],
  },
  {
    name: 'سمانة',
    icon: 'ShoppingBasket',
    products: [
      'طون', 'سردين', 'مرتديلا', 'حليب', 'حموي أحمر ك', 'حموي أخضر ك',
      'حموي أخضر ص', 'قرص برغش', 'شرتيطون', 'لزيق عريض', 'محارم معطرة',
      'محارم صغيرة', 'محارم كبيرة',
    ],
  },
  {
    name: 'بسكويت',
    icon: 'Cookie',
    products: [
      'بسكوتة 1000', 'بسكوتة 2000', 'بسكوتة 3000', 'بسكوتة 4000', 'بسكوتة 5000',
     
    ],
  },
  {
    name: 'سكاكر وعلكة',
    icon: 'Candy',
    products: ['زاهي', 'كلورتس'],
  },
  {
    name: 'تسالي',
    icon: 'Popcorn',
    products: ['بزر أسود', 'عبيد', 'لوز', 'بزر كوسا', 'بزر أصفر', 'نقارش'],
  },
  {
    name: 'مستلزمات أخرى',
    icon: 'Package',
    products: ['التيكو','كاسات كبيرة', 'كاسات صغيرة', 'كاسات', 'إندومي'],
  },
];

async function clearData(): Promise<void> {
  // Order matters: children before parents
  await client.query('DELETE FROM refresh_tokens');
  await client.query('DELETE FROM audit_logs');
  await client.query('DELETE FROM receipt_items');
  await client.query('DELETE FROM receipts');
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
    'receipts_id_seq', 'receipt_items_id_seq',
  ]) {
    await client.query(`ALTER SEQUENCE ${seq} RESTART WITH 1`);
  }
}

async function seedWarehouse(): Promise<void> {
  // Single warehouse shop + its admin account.
  await client.query(`
    INSERT INTO shops (id, name, address, phone, type) VALUES
      (1, 'Main Warehouse', 'Industrial Zone, Block 1', '+1-555-0100', 'WAREHOUSE')
  `);
  await client.query(`SELECT setval('shops_id_seq', 1)`);

  await client.query(
    `INSERT INTO users (id, shop_id, name, email, password_hash, role, is_active)
     VALUES (1, 1, 'Warehouse Admin', 'admin@warehouse.com', $1, 'WAREHOUSE_ADMIN', TRUE)`,
    [HASH_ADMIN],
  );
  await client.query(`SELECT setval('users_id_seq', 1)`);
}

async function seedCatalog(): Promise<void> {
  let categoryId = 1;
  let productId = 1;

  for (const category of CATALOG) {
    await client.query(
      `INSERT INTO categories (id, shop_id, name, icon) VALUES ($1, 1, $2, $3)`,
      [categoryId, category.name, category.icon],
    );

    for (const productName of category.products) {
      // is_orderable = FALSE: these are catalog-only templates (name/category so
      // a shop can self-register the product), not real warehouse stock. Flip to
      // TRUE once the warehouse actually stocks and can fulfill orders for one.
      await client.query(
        `INSERT INTO products (id, shop_id, category_id, name, is_global, source, is_active, is_orderable)
         VALUES ($1, 1, $2, $3, TRUE, 'WAREHOUSE', TRUE, FALSE)`,
        [productId, categoryId, productName],
      );
      productId++;
    }

    categoryId++;
  }

  await client.query(`SELECT setval('categories_id_seq', $1)`, [categoryId - 1]);
  await client.query(`SELECT setval('products_id_seq', $1)`, [productId - 1]);
}

async function run(): Promise<void> {
  try {
    await client.connect();
    console.log('Connected to database');

    const { rows } = await client.query<{ count: string }>(
      'SELECT COUNT(*)::int AS count FROM shops',
    );
    if (Number(rows[0].count) > 0 && process.env.FORCE_SEED !== 'true') {
      console.log('Database already seeded — skipping (set FORCE_SEED=true to override).');
      return;
    }

    console.log('Clearing existing data…');
    await clearData();

    console.log('Seeding warehouse + admin…');
    await seedWarehouse();

    console.log('Seeding catalog…');
    await seedCatalog();

    const categoryCount = CATALOG.length;
    const productCount = CATALOG.reduce((sum, c) => sum + c.products.length, 0);

    console.log(`\n✓ Seed complete. ${categoryCount} categories, ${productCount} products.`);
    console.log('  Login: admin@warehouse.com / Admin@123 (WAREHOUSE_ADMIN)');
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
