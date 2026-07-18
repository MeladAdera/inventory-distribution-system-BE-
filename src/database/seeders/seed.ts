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

// Finds the warehouse shop, creating it (with its admin account) only if one
// doesn't exist yet. Never touches other shops/users — safe to run against a
// database that already has real, user-created data.
async function ensureWarehouseAdmin(): Promise<number> {
  const { rows: existing } = await client.query<{ id: number }>(
    `SELECT id FROM shops WHERE type = 'WAREHOUSE' LIMIT 1`,
  );
  if (existing.length > 0) {
    console.log('Warehouse shop already exists — skipping.');
    return existing[0].id;
  }

  const { rows: inserted } = await client.query<{ id: number }>(
    `INSERT INTO shops (name, address, phone, type)
     VALUES ('Main Warehouse', 'Industrial Zone, Block 1', '+1-555-0100', 'WAREHOUSE')
     RETURNING id`,
  );
  const shopId = inserted[0].id;

  await client.query(
    `INSERT INTO users (shop_id, name, email, password_hash, role, is_active)
     VALUES ($1, 'Warehouse Admin', 'admin@warehouse.com', $2, 'WAREHOUSE_ADMIN', TRUE)`,
    [shopId, HASH_ADMIN],
  );

  console.log('Seeded warehouse + admin.');
  return shopId;
}

// Inserts only the categories/products that don't already exist for this shop.
// Relies on IDs assigned by Postgres (not hardcoded), so it can't collide with
// rows created through the running app, and reruns are pure no-ops once caught up.
async function seedCatalog(shopId: number): Promise<{ categories: number; products: number }> {
  let categoriesAdded = 0;
  let productsAdded = 0;

  for (const category of CATALOG) {
    const { rows: existingCategory } = await client.query<{ id: number }>(
      `SELECT id FROM categories WHERE shop_id = $1 AND LOWER(name) = LOWER($2)`,
      [shopId, category.name],
    );

    let categoryId: number;
    if (existingCategory.length > 0) {
      categoryId = existingCategory[0].id;
    } else {
      const { rows: insertedCategory } = await client.query<{ id: number }>(
        `INSERT INTO categories (shop_id, name, icon) VALUES ($1, $2, $3) RETURNING id`,
        [shopId, category.name, category.icon],
      );
      categoryId = insertedCategory[0].id;
      categoriesAdded++;
    }

    for (const productName of category.products) {
      // is_orderable = FALSE: these are catalog-only templates (name/category so
      // a shop can self-register the product), not real warehouse stock. Flip to
      // TRUE once the warehouse actually stocks and can fulfill orders for one.
      const result = await client.query(
        `INSERT INTO products (shop_id, category_id, name, is_global, source, is_active, is_orderable)
         VALUES ($1, $2, $3, TRUE, 'WAREHOUSE', TRUE, FALSE)
         ON CONFLICT (shop_id, (LOWER(name))) WHERE is_active = TRUE DO NOTHING`,
        [shopId, categoryId, productName],
      );
      if (result.rowCount) productsAdded++;
    }
  }

  return { categories: categoriesAdded, products: productsAdded };
}

async function run(): Promise<void> {
  try {
    await client.connect();
    console.log('Connected to database');

    await client.query('BEGIN');
    let shopId: number;
    let categoriesAdded: number;
    let productsAdded: number;
    try {
      shopId = await ensureWarehouseAdmin();

      console.log('Checking catalog…');
      ({ categories: categoriesAdded, products: productsAdded } = await seedCatalog(shopId));

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    console.log(`\n✓ Seed check complete. ${categoriesAdded} new categories, ${productsAdded} new products added.`);
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
