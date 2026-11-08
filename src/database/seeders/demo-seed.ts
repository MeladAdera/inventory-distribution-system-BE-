import * as pg from 'pg';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

/**
 * Synthetic data for the public demo. This file exists only on the `demo`
 * branch and must never be merged to `main`.
 *
 * Unlike seed.ts this is destructive: a reset empties every table. Two things
 * must both be true before it runs: DEMO_MODE=true, and the database holds the
 * hand-created `demo_environment` marker table, which production never has.
 */

dotenv.config({ path: `.env.${process.env.NODE_ENV || 'development'}` });

const MARKER_TABLE = 'demo_environment';
const PRESERVED_TABLES = ['migrations', MARKER_TABLE];
const DEMO_PASSWORD = 'Demo@2026';
const DEMO_ADMIN_EMAIL = 'demo-admin@example.com';
// Any constant works; it only has to be the same in every instance.
const BOOT_LOCK_KEY = 20_261_107;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HISTORY_DAYS = 60;
const SHIFT_HISTORY_DAYS = 14;
const SHIFT_CHANGE_HOUR = 15;
const OPENING_FLOAT_CENTS = 5_000;

const WAREHOUSE = 1;
const SHOP_A = 2;
const SHOP_B = 3;
const SHOP_C = 4;
const RETAIL_SHOPS = [SHOP_A, SHOP_B, SHOP_C];

const ADMIN = 1;
const OWNERS: Record<number, number> = { [SHOP_A]: 2, [SHOP_B]: 3, [SHOP_C]: 4 };

const SHOPS = [
  { id: WAREHOUSE, name: 'Central Warehouse', address: '4 Distribution Park', phone: '+1-555-0100', type: 'WAREHOUSE' },
  { id: SHOP_A, name: 'Maple Street Market', address: '12 Maple Street', phone: '+1-555-0101', type: 'SHOP' },
  { id: SHOP_B, name: 'Harbor Corner Store', address: '88 Harbor Road', phone: '+1-555-0102', type: 'SHOP' },
  { id: SHOP_C, name: 'Riverside Mini Mart', address: '5 Riverside Walk', phone: '+1-555-0103', type: 'SHOP' },
];

const USERS = [
  { id: ADMIN, shop_id: WAREHOUSE, name: 'Dana Warehouse', email: DEMO_ADMIN_EMAIL, role: 'WAREHOUSE_ADMIN' },
  { id: 2, shop_id: SHOP_A, name: 'Olivia Owner', email: 'demo-owner@example.com', role: 'SHOP_OWNER' },
  { id: 3, shop_id: SHOP_B, name: 'Noah Owner', email: 'demo-owner2@example.com', role: 'SHOP_OWNER' },
  { id: 4, shop_id: SHOP_C, name: 'Emma Owner', email: 'demo-owner3@example.com', role: 'SHOP_OWNER' },
  { id: 5, shop_id: SHOP_A, name: 'Evan Employee', email: 'demo-employee@example.com', role: 'EMPLOYEE' },
  { id: 6, shop_id: SHOP_A, name: 'Mia Employee', email: 'demo-employee2@example.com', role: 'EMPLOYEE' },
  { id: 7, shop_id: SHOP_B, name: 'Liam Employee', email: 'demo-employee3@example.com', role: 'EMPLOYEE' },
  { id: 8, shop_id: SHOP_C, name: 'Ava Employee', email: 'demo-employee4@example.com', role: 'EMPLOYEE' },
];

/** Rows at or below these ids are protected from visitors by DemoGuard. */
export const DEMO_SEEDED_SHOP_MAX_ID = SHOPS.length;
export const DEMO_SEEDED_USER_MAX_ID = USERS.length;

const EMPLOYEES: Record<number, number[]> = { [SHOP_A]: [5, 6], [SHOP_B]: [7], [SHOP_C]: [8] };

type CatalogItem = [name: string, price: number, cost: number];

const CATALOG: { name: string; icon: string; products: CatalogItem[] }[] = [
  {
    name: 'Cold Drinks',
    icon: 'CupSoda',
    products: [
      ['Sparkling Water 1L', 1.2, 0.7], ['Orange Juice 1L', 2.8, 1.7], ['Apple Juice 1L', 2.6, 1.6],
      ['Cola Can 330ml', 0.9, 0.5], ['Lemon Soda Can 330ml', 0.9, 0.5], ['Peach Iced Tea 500ml', 1.5, 0.85],
      ['Still Water 500ml', 0.5, 0.25], ['Mineral Water 1.5L', 0.8, 0.4],
    ],
  },
  {
    name: 'Hot Drinks',
    icon: 'Coffee',
    products: [
      ['Ground Coffee 250g', 5.5, 3.4], ['Instant Coffee 100g', 4.2, 2.6], ['Black Tea 50 Bags', 3.6, 2.1],
      ['Green Tea 25 Bags', 2.9, 1.7], ['Hot Chocolate Mix', 3.4, 2.0], ['Herbal Tea 20 Bags', 3.1, 1.8],
    ],
  },
  {
    name: 'Snacks',
    icon: 'Cookie',
    products: [
      ['Salted Potato Chips', 1.4, 0.8], ['Butter Cookies', 2.2, 1.3], ['Milk Chocolate Bar', 1.1, 0.6],
      ['Roasted Peanuts 200g', 1.9, 1.1], ['Granola Bars 6 Pack', 3.3, 2.0], ['Cheese Crackers', 1.6, 0.9],
      ['Mixed Nuts 150g', 3.8, 2.4],
    ],
  },
  {
    name: 'Grocery',
    icon: 'ShoppingBasket',
    products: [
      ['Long Grain Rice 1kg', 2.4, 1.5], ['Spaghetti 500g', 1.3, 0.75], ['Tomato Sauce 400g', 1.2, 0.7],
      ['Olive Oil 500ml', 6.5, 4.3], ['White Sugar 1kg', 1.3, 0.85], ['Canned Tuna 160g', 1.9, 1.15],
      ['Red Lentils 1kg', 2.7, 1.7], ['Wheat Flour 1kg', 1.1, 0.65],
    ],
  },
  {
    name: 'Household',
    icon: 'SprayCan',
    products: [
      ['Dish Soap 500ml', 1.8, 1.0], ['Laundry Powder 1kg', 4.6, 2.9], ['Paper Towels 2 Rolls', 2.5, 1.5],
      ['All Purpose Cleaner', 2.3, 1.3], ['Trash Bags 30 Pack', 2.1, 1.2],
    ],
  },
  {
    name: 'Personal Care',
    icon: 'Sparkles',
    products: [
      ['Bar Soap 4 Pack', 2.4, 1.4], ['Shampoo 400ml', 3.9, 2.3], ['Toothpaste 100ml', 1.9, 1.05],
      ['Hand Cream 75ml', 2.8, 1.6], ['Cotton Buds 200 Pack', 1.2, 0.6], ['Body Lotion 250ml', 4.4, 2.7],
    ],
  },
];

// Known to the catalog, but the warehouse does not stock them.
const CATALOG_ONLY: [name: string, category: number][] = [
  ['Sparkling Grape Juice 750ml', 1], ['Oat Milk 1L', 4], ['Bamboo Toothbrush', 6],
];

const LOCAL_PRODUCTS: Record<number, CatalogItem[]> = {
  [SHOP_A]: [['Corner Bakery Bread', 1.6, 0.9], ['Homemade Hummus Tub', 3.2, 1.8], ['Fresh Mint Bunch', 0.9, 0.4]],
  [SHOP_B]: [['Farm Eggs 12 Pack', 3.4, 2.2], ['Local Honey Jar', 7.5, 4.8], ['Harbor Sea Salt', 2.2, 1.1]],
  [SHOP_C]: [['Riverside Roast Coffee', 8.5, 5.2], ['Handmade Olive Soap', 3.6, 1.9], ['Garden Tomatoes 1kg', 2.4, 1.3]],
};

const RETAIL_MARKUP: Record<number, number> = { [SHOP_A]: 1.25, [SHOP_B]: 1.2, [SHOP_C]: 1.3 };

const CUSTOMER_NAMES = [
  'Alex Morgan', 'Jamie Lee', 'Sam Rivera', 'Taylor Brooks', 'Jordan Patel', 'Casey Nguyen',
  'Riley Chen', 'Morgan Davis', 'Avery Clark', 'Quinn Foster', 'Drew Bennett', 'Skyler Reed',
];

const WAREHOUSE_SUPPLIERS = ['Northwind Foods Supply', 'Blue Harbor Beverages', 'Clearline Home Goods'];

type OrderStatus = 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'RECEIVED' | 'COMPLETED' | 'CANCELLED';

// The open orders are recent and mostly Shop A's, so a visitor logging in as
// demo-owner or demo-admin finds one at every step of the lifecycle.
const ORDER_PLAN: { daysAgo: number; shop: number; status: OrderStatus }[] = [
  ...[58, 55, 52, 49, 46, 43, 40, 37, 34, 31, 28, 25, 22, 19, 16, 13, 10, 7].map((daysAgo, i) => ({
    daysAgo,
    shop: RETAIL_SHOPS[i % RETAIL_SHOPS.length],
    status: 'COMPLETED' as const,
  })),
  { daysAgo: 41, shop: SHOP_B, status: 'CANCELLED' },
  { daysAgo: 23, shop: SHOP_C, status: 'CANCELLED' },
  { daysAgo: 9, shop: SHOP_A, status: 'CANCELLED' },
  { daysAgo: 6, shop: SHOP_A, status: 'RECEIVED' },
  { daysAgo: 5, shop: SHOP_B, status: 'RECEIVED' },
  { daysAgo: 4, shop: SHOP_C, status: 'RECEIVED' },
  { daysAgo: 3, shop: SHOP_A, status: 'SHIPPED' },
  { daysAgo: 2, shop: SHOP_B, status: 'SHIPPED' },
  { daysAgo: 2, shop: SHOP_A, status: 'PROCESSING' },
  { daysAgo: 1, shop: SHOP_A, status: 'PENDING' },
  { daysAgo: 1, shop: SHOP_C, status: 'PENDING' },
  { daysAgo: 0, shop: SHOP_A, status: 'PENDING' },
];

const STATUS_PATH: OrderStatus[] = ['PENDING', 'PROCESSING', 'SHIPPED', 'RECEIVED', 'COMPLETED'];
const STATUS_OFFSET_MS: Partial<Record<OrderStatus, number>> = {
  PROCESSING: 4 * HOUR,
  SHIPPED: DAY,
  RECEIVED: 2 * DAY,
  COMPLETED: 3 * DAY,
};
const DELIVERY_DELAY_DAYS = 2;

type Row = Record<string, unknown>;

interface InventoryRow extends Row {
  id: number;
  shop_id: number;
  product_id: number;
  current_quantity: number;
  low_stock_threshold: number;
  avg_cost: string;
  sale_price: string;
}

interface Product {
  id: number;
  name: string;
  priceCents: number;
  costCents: number;
}

interface Payment {
  cents: number;
  at: Date;
  sessionId?: number | null;
}

// Keys are in insert order, which is foreign-key order.
function emptyTables(): Record<string, Row[]> {
  return {
    shops: [], users: [], categories: [], products: [], inventory: [], suppliers: [], customers: [],
    shop_opening_hours: [], shift_templates: [], shift_assignments: [], shift_sessions: [],
    orders: [], order_items: [], receipts: [], receipt_items: [], debts: [], debt_payments: [],
    supplier_debt_items: [], notifications: [], audit_logs: [],
  };
}

/** Small seeded PRNG: every reset produces the same data, only dates move. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toCents = (amount: number): number => Math.round(amount * 100);
const fromCents = (cents: number): string => (cents / 100).toFixed(2);

function buildDemoData(now: Date, passwordHash: string): Record<string, Row[]> {
  const t = emptyTables();
  const random = createRandom(20261107);
  const int = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
  const pick = <T,>(items: T[]): T => items[int(0, items.length - 1)];
  const shuffled = <T,>(items: T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const notAfterNow = (date: Date): Date => (date > now ? now : date);
  const atHour = (daysAgo: number, hour: number, minute = 0): Date => {
    const date = new Date(now.getTime() - daysAgo * DAY);
    date.setUTCHours(hour, minute, 0, 0);
    return notAfterNow(date);
  };
  const established = new Date(now.getTime() - (HISTORY_DAYS + 30) * DAY);

  const audit = (row: Row, at: Date): void => {
    t.audit_logs.push({
      id: t.audit_logs.length + 1,
      shop_id: null, user_id: null, type: null, action: null, entity_type: null, entity_id: null,
      receipt_id: null, quantity: null, amount: null, notes: null,
      ...row,
      created_at: at,
    });
  };
  const keyedNote = (key: string, args: Row): string => JSON.stringify({ key, args });

  const notify = (
    shopId: number, kind: 'ORDER_CREATED' | 'ORDER_STATUS' | 'LOW_STOCK', args: Row, at: Date, isRead: boolean,
  ): void => {
    const prefix = kind === 'ORDER_CREATED' ? 'ORDER_CREATED' : kind === 'ORDER_STATUS' ? 'ORDER_STATUS' : 'LOW_STOCK';
    t.notifications.push({
      id: t.notifications.length + 1,
      shop_id: shopId,
      user_id: null,
      title: `notifications.${prefix}_TITLE`,
      message: `notifications.${prefix}_MESSAGE`,
      type: kind,
      args,
      is_read: isRead,
      created_at: at,
    });
  };

  // A debt and its payment ledger, built together so paid_amount and status
  // can't disagree with the payment rows.
  const addDebt = (
    fields: Row, totalCents: number, createdAt: Date, createdBy: number, payments: Payment[],
  ): number => {
    const debtId = t.debts.length + 1;
    const paidCents = payments.reduce((sum, p) => sum + p.cents, 0);
    const status = paidCents >= totalCents ? 'PAID' : paidCents > 0 ? 'PARTIAL' : 'OPEN';
    const lastPaidAt = payments.length > 0 ? payments[payments.length - 1].at : createdAt;

    t.debts.push({
      id: debtId,
      creditor_shop_id: null, creditor_type: 'SHOP', debtor_type: 'SHOP', debtor_shop_id: null,
      customer_id: null, supplier_id: null, invoice_no: null, order_id: null, receipt_id: null,
      note: null,
      ...fields,
      total_amount: fromCents(totalCents),
      paid_amount: fromCents(paidCents),
      status,
      created_by: createdBy,
      created_at: createdAt,
      updated_at: lastPaidAt,
    });

    for (const payment of payments) {
      t.debt_payments.push({
        id: t.debt_payments.length + 1,
        debt_id: debtId,
        amount: fromCents(payment.cents),
        method: payment.sessionId ? 'CASH' : pick(['CASH', 'TRANSFER']),
        paid_at: payment.at,
        created_by: createdBy,
        created_at: payment.at,
        shift_session_id: payment.sessionId ?? null,
      });
    }
    return debtId;
  };

  /** Later payments against a debt: settled, part-paid, or nothing yet. */
  const followUpPayments = (remainingCents: number, from: Date, settleChance: number): Payment[] => {
    const roll = random();
    const firstAt = notAfterNow(new Date(from.getTime() + int(2, 9) * DAY));
    if (roll < settleChance) return [{ cents: remainingCents, at: firstAt }];
    if (roll < settleChance + (1 - settleChance) / 2) {
      return [{ cents: Math.max(1, Math.floor(remainingCents * (int(25, 70) / 100))), at: firstAt }];
    }
    return [];
  };

  // ── Reference data ─────────────────────────────────────────────────────────
  for (const shop of SHOPS) {
    t.shops.push({ ...shop, timezone: 'UTC', created_at: established, updated_at: established });
  }
  for (const user of USERS) {
    t.users.push({ ...user, password_hash: passwordHash, created_at: established, updated_at: established });
  }

  const warehouseProducts: Product[] = [];
  CATALOG.forEach((category, index) => {
    const categoryId = index + 1;
    t.categories.push({
      id: categoryId, shop_id: WAREHOUSE, name: category.name, icon: category.icon,
      created_at: established, updated_at: established,
    });
    for (const [name, price, cost] of category.products) {
      const id = t.products.length + 1;
      t.products.push({
        id, category_id: categoryId, shop_id: WAREHOUSE, name,
        description: `${name} (demo product)`,
        barcode: `200${String(id).padStart(10, '0')}`,
        price: price.toFixed(2), cost_price: cost.toFixed(2),
        is_global: true, source: 'WAREHOUSE', is_orderable: true,
        created_at: established, updated_at: established,
      });
      warehouseProducts.push({ id, name, priceCents: toCents(price), costCents: toCents(cost) });
    }
  });

  for (const [name, categoryId] of CATALOG_ONLY) {
    const id = t.products.length + 1;
    t.products.push({
      id, category_id: categoryId, shop_id: WAREHOUSE, name,
      description: `${name} (demo catalog entry)`,
      barcode: `200${String(id).padStart(10, '0')}`,
      price: '0.00', cost_price: '0.00',
      is_global: true, source: 'WAREHOUSE', is_orderable: false,
      created_at: established, updated_at: established,
    });
  }

  // ── Inventory ──────────────────────────────────────────────────────────────
  // `floor` is the quantity the simulation stops at, which is how specific rows
  // are made to end the history low or sold out for the shortages pages.
  const floors = new Map<number, number>();
  const productById = new Map<number, Product>();
  const addInventory = (
    shopId: number, product: Product, quantity: number, threshold: number, salePriceCents: number, floor: number,
  ): InventoryRow => {
    const row: InventoryRow = {
      id: t.inventory.length + 1,
      shop_id: shopId,
      product_id: product.id,
      current_quantity: quantity,
      low_stock_threshold: threshold,
      avg_cost: (product.costCents / 100).toFixed(4),
      sale_price: fromCents(salePriceCents),
      updated_at: now,
    };
    t.inventory.push(row);
    floors.set(row.id, floor);
    productById.set(product.id, product);
    return row;
  };

  const WAREHOUSE_RESERVE = 80;
  const OUT_OF_STOCK_IDS = new Set([warehouseProducts[7].id, warehouseProducts[33].id]);
  const LOW_STOCK_IDS = new Set([warehouseProducts[13].id, warehouseProducts[20].id, warehouseProducts[28].id]);

  const warehouseRows = new Map<number, InventoryRow>();
  for (const product of warehouseProducts) {
    const quantity = OUT_OF_STOCK_IDS.has(product.id) ? 0 : LOW_STOCK_IDS.has(product.id) ? 15 : int(220, 420);
    const isShort = OUT_OF_STOCK_IDS.has(product.id) || LOW_STOCK_IDS.has(product.id);
    warehouseRows.set(
      product.id,
      addInventory(WAREHOUSE, product, quantity, 25, product.priceCents, isShort ? quantity : WAREHOUSE_RESERVE),
    );
  }

  const orderableRows = new Map<number, InventoryRow[]>();
  const sellableRows = new Map<number, InventoryRow[]>();
  const fastSellers = new Map<number, InventoryRow[]>();

  for (const shopId of RETAIL_SHOPS) {
    const markup = RETAIL_MARKUP[shopId];
    const stocked = shuffled(warehouseProducts.filter((p) => !OUT_OF_STOCK_IDS.has(p.id))).slice(0, 24);
    const rows = stocked.map((product, index) => {
      const salePriceCents = Math.round(product.priceCents * markup);
      if (index < 2) return addInventory(shopId, product, 12, 10, salePriceCents, 0);
      if (index < 4) return addInventory(shopId, product, 16, 10, salePriceCents, int(3, 7));
      return addInventory(shopId, product, int(30, 60), index % 5 === 0 ? 15 : 10, salePriceCents, 0);
    });
    fastSellers.set(shopId, rows.slice(0, 4));
    orderableRows.set(shopId, rows.slice(4));

    const localRows = LOCAL_PRODUCTS[shopId].map(([name, price, cost]) => {
      const id = t.products.length + 1;
      t.products.push({
        id, category_id: 4, shop_id: shopId, name,
        description: `${name} (demo local product)`,
        barcode: `200${String(id).padStart(10, '0')}`,
        price: price.toFixed(2), cost_price: cost.toFixed(2),
        is_global: false, source: 'LOCAL', is_orderable: true,
        created_at: established, updated_at: established,
      });
      const product: Product = { id, name, priceCents: toCents(price), costCents: toCents(cost) };
      return addInventory(shopId, product, int(25, 45), 10, product.priceCents, 0);
    });
    sellableRows.set(shopId, [...rows.slice(4), ...localRows]);
  }

  // ── Suppliers: the warehouse's opening stock arrived on these bills ────────
  const supplierPhone = (n: number): string => `+1-555-01${String(10 + n).padStart(2, '0')}`;
  WAREHOUSE_SUPPLIERS.forEach((name, index) => {
    const supplierId = t.suppliers.length + 1;
    t.suppliers.push({
      id: supplierId, shop_id: WAREHOUSE, name, phone: supplierPhone(supplierId), note: 'Demo supplier',
      created_at: established, updated_at: established,
    });

    const lines = warehouseProducts
      .filter((_product, productIndex) => productIndex % WAREHOUSE_SUPPLIERS.length === index)
      .map((product) => ({ product, row: warehouseRows.get(product.id)! }))
      .filter(({ row }) => row.current_quantity > 0);

    const totalCents = lines.reduce((sum, { product, row }) => sum + product.costCents * row.current_quantity, 0);
    const billedAt = atHour(HISTORY_DAYS - index, 9);
    const payments: Payment[] = index === 2
      ? []
      : [{ cents: index === 0 ? totalCents : Math.floor(totalCents * 0.4), at: new Date(billedAt.getTime() + 10 * DAY) }];

    const debtId = addDebt(
      {
        creditor_type: 'SUPPLIER', debtor_type: 'SHOP', debtor_shop_id: WAREHOUSE, supplier_id: supplierId,
        invoice_no: `INV-${1001 + index}`, note: 'Opening stock purchase',
      },
      totalCents, billedAt, ADMIN, payments,
    );

    for (const { product, row } of lines) {
      t.supplier_debt_items.push({
        id: t.supplier_debt_items.length + 1,
        debt_id: debtId,
        product_id: product.id,
        inventory_id: row.id,
        quantity: row.current_quantity,
        unit_cost: (product.costCents / 100).toFixed(4),
        created_at: billedAt,
      });
    }
  });

  // A bill with no line items is valid: it pays for a service, not goods.
  const shopBills: [shop: number, name: string, invoice: string, cents: number, paidCents: number][] = [
    [SHOP_A, 'Cooltech Refrigeration', 'CT-2204', 18_000, 0],
    [SHOP_B, 'Swift Local Delivery', 'SD-0917', 9_600, 4_000],
  ];
  for (const [shopId, name, invoice, cents, paidCents] of shopBills) {
    const supplierId = t.suppliers.length + 1;
    t.suppliers.push({
      id: supplierId, shop_id: shopId, name, phone: supplierPhone(supplierId), note: 'Demo supplier',
      created_at: established, updated_at: established,
    });
    const billedAt = atHour(18, 11);
    addDebt(
      {
        creditor_type: 'SUPPLIER', debtor_type: 'SHOP', debtor_shop_id: shopId, supplier_id: supplierId,
        invoice_no: invoice, note: 'Service invoice',
      },
      cents, billedAt, OWNERS[shopId],
      paidCents > 0 ? [{ cents: paidCents, at: new Date(billedAt.getTime() + 5 * DAY) }] : [],
    );
  }

  // ── Customers ──────────────────────────────────────────────────────────────
  const customersByShop = new Map<number, number[]>();
  RETAIL_SHOPS.forEach((shopId, shopIndex) => {
    const ids = CUSTOMER_NAMES.slice(shopIndex * 4, shopIndex * 4 + 4).map((name) => {
      const id = t.customers.length + 1;
      t.customers.push({
        id, shop_id: shopId, name, phone: `+1-555-01${String(20 + id).padStart(2, '0')}`,
        note: null, created_at: established, updated_at: established,
      });
      return id;
    });
    customersByShop.set(shopId, ids);
  });

  // ── Opening hours, weekly plan, rota ───────────────────────────────────────
  const templateIds = new Map<string, number>();
  const rostered = new Set<string>();
  for (const shopId of RETAIL_SHOPS) {
    const staff = EMPLOYEES[shopId];
    for (let weekday = 0; weekday < 7; weekday++) {
      t.shop_opening_hours.push({
        shop_id: shopId, weekday, open_time: '08:00', close_time: '22:00', is_closed: false,
      });
      const slots: [slot: number, name: string, start: string, end: string, userId: number][] = [
        [1, 'Morning', '08:00', `${SHIFT_CHANGE_HOUR}:00`, staff[0]],
        [2, 'Evening', `${SHIFT_CHANGE_HOUR}:00`, '22:00', staff[staff.length - 1]],
      ];
      for (const [slot, name, start, end, userId] of slots) {
        const templateId = t.shift_templates.length + 1;
        t.shift_templates.push({
          id: templateId, shop_id: shopId, weekday, slot_index: slot, name,
          start_time: start, end_time: end, created_at: established, updated_at: established,
        });
        t.shift_assignments.push({
          id: t.shift_assignments.length + 1, shift_template_id: templateId, user_id: userId, created_at: established,
        });
        templateIds.set(`${shopId}:${weekday}:${slot}`, templateId);
        rostered.add(`${templateId}:${userId}`);
      }
    }
  }

  // Closed shifts only: one open shift per shop is allowed, and visitors need
  // to be able to open their own.
  const sessionIds = new Map<string, number>();
  const sessionCash = new Map<number, { sales: number; collections: number }>();
  for (let daysAgo = SHIFT_HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
    for (const shopId of RETAIL_SHOPS) {
      const staff = EMPLOYEES[shopId];
      const dayStart = atHour(daysAgo, 0);
      const weekday = dayStart.getUTCDay();
      const businessDate = dayStart.toISOString().slice(0, 10);

      for (const slot of [1, 2]) {
        const id = t.shift_sessions.length + 1;
        const templateId = templateIds.get(`${shopId}:${weekday}:${slot}`)!;
        // Single-employee shops have the owner cover the evening every few days,
        // which is what the off-schedule flag exists to show.
        const covering = slot === 2 && staff.length === 1 && daysAgo % 3 === 0;
        const userId = covering ? OWNERS[shopId] : slot === 1 ? staff[0] : staff[staff.length - 1];
        t.shift_sessions.push({
          id,
          shop_id: shopId,
          user_id: userId,
          shift_template_id: templateId,
          business_date: businessDate,
          opened_at: atHour(daysAgo, slot === 1 ? 8 : SHIFT_CHANGE_HOUR, int(0, 5)),
          closed_at: atHour(daysAgo, slot === 1 ? SHIFT_CHANGE_HOUR : 22, int(0, 8)),
          closed_by: userId,
          is_off_schedule: !rostered.has(`${templateId}:${userId}`),
          status: 'CLOSED',
        });
        sessionIds.set(`${shopId}:${daysAgo}:${slot}`, id);
        sessionCash.set(id, { sales: 0, collections: 0 });
      }
    }
  }

  // ── Orders ─────────────────────────────────────────────────────────────────
  interface Delivery {
    dueDay: number;
    orderId: number;
    shopId: number;
    at: Date;
    items: { row: InventoryRow; quantity: number }[];
  }
  const deliveries: Delivery[] = [];

  const placeOrder = (plan: (typeof ORDER_PLAN)[number]): void => {
    const orderId = t.orders.length + 1;
    const createdAt = plan.daysAgo === 0 ? new Date(now.getTime() - HOUR) : atHour(plan.daysAgo, 10);
    const ownerId = OWNERS[plan.shop];

    const items: { row: InventoryRow; product: Product; quantity: number }[] = [];
    for (const row of shuffled(orderableRows.get(plan.shop)!)) {
      if (items.length >= int(3, 6)) break;
      const warehouseRow = warehouseRows.get(row.product_id)!;
      const available = warehouseRow.current_quantity - floors.get(warehouseRow.id)!;
      const quantity = Math.min(6 * int(2, 6), available);
      if (quantity <= 0) continue;

      warehouseRow.current_quantity -= quantity;
      const product = productById.get(row.product_id)!;
      items.push({ row, product, quantity });
      t.order_items.push({
        id: t.order_items.length + 1,
        order_id: orderId,
        product_id: product.id,
        quantity,
        price: fromCents(product.priceCents),
        cost_price: warehouseRow.avg_cost,
      });
      audit(
        {
          shop_id: WAREHOUSE, user_id: ownerId, type: 'INVENTORY', action: 'TRANSFER_OUT',
          entity_type: 'inventory', entity_id: warehouseRow.id, quantity,
          notes: keyedNote('audit-logs.NOTE_ORDER_RESERVED', { orderId, shopId: plan.shop }),
        },
        createdAt,
      );
    }

    const statusChanged = (from: OrderStatus, to: OrderStatus, at: Date, userId: number): void => {
      audit(
        {
          user_id: userId, type: 'ORDER', action: 'STATUS_CHANGED', entity_type: 'order', entity_id: orderId,
          notes: keyedNote('audit-logs.NOTE_STATUS_CHANGED', {
            from: { key: `audit-logs.STATUS.${from}` },
            to: { key: `audit-logs.STATUS.${to}` },
          }),
        },
        at,
      );
      if (now.getTime() - at.getTime() < 10 * DAY) {
        notify(plan.shop, 'ORDER_STATUS', { orderId, status: to }, at, now.getTime() - at.getTime() > 3 * DAY);
      }
    };

    let updatedAt = createdAt;
    if (plan.status === 'CANCELLED') {
      updatedAt = new Date(createdAt.getTime() + 6 * HOUR);
      statusChanged('PENDING', 'CANCELLED', updatedAt, ownerId);
      for (const { row, quantity } of items) {
        const warehouseRow = warehouseRows.get(row.product_id)!;
        warehouseRow.current_quantity += quantity;
        audit(
          {
            shop_id: WAREHOUSE, user_id: ownerId, type: 'INVENTORY', action: 'TRANSFER_IN',
            entity_type: 'inventory', entity_id: warehouseRow.id, quantity,
            notes: keyedNote('audit-logs.NOTE_ORDER_RESTOCKED', { orderId }),
          },
          updatedAt,
        );
      }
    } else {
      const lastStep = STATUS_PATH.indexOf(plan.status);
      for (let step = 1; step <= lastStep; step++) {
        const status = STATUS_PATH[step];
        updatedAt = new Date(createdAt.getTime() + STATUS_OFFSET_MS[status]!);
        statusChanged(STATUS_PATH[step - 1], status, updatedAt, status === 'RECEIVED' ? ownerId : ADMIN);
      }
    }

    t.orders.push({
      id: orderId,
      from_shop_id: WAREHOUSE,
      to_shop_id: plan.shop,
      status: plan.status,
      total_items: items.reduce((sum, item) => sum + item.quantity, 0),
      created_at: createdAt,
      updated_at: updatedAt,
    });

    if (plan.status === 'PENDING') {
      notify(WAREHOUSE, 'ORDER_CREATED', { orderId }, createdAt, false);
    }

    const shippedOrLater = STATUS_PATH.indexOf(plan.status) >= STATUS_PATH.indexOf('SHIPPED');
    if (shippedOrLater) {
      const shippedAt = new Date(createdAt.getTime() + STATUS_OFFSET_MS.SHIPPED!);
      const totalCents = items.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0);
      addDebt(
        { creditor_shop_id: WAREHOUSE, debtor_shop_id: plan.shop, order_id: orderId, note: `Order #${orderId}` },
        totalCents, shippedAt, ADMIN,
        followUpPayments(totalCents, shippedAt, plan.daysAgo > 20 ? 0.8 : 0.3),
      );
    }

    if (plan.status === 'RECEIVED' || plan.status === 'COMPLETED') {
      deliveries.push({
        dueDay: plan.daysAgo - DELIVERY_DELAY_DAYS,
        orderId,
        shopId: plan.shop,
        at: new Date(createdAt.getTime() + STATUS_OFFSET_MS.RECEIVED!),
        items,
      });
    }
  };

  const deliver = ({ orderId, shopId, at, items }: Delivery): void => {
    for (const { row, quantity } of items) {
      row.current_quantity += quantity;
      audit(
        {
          shop_id: shopId, user_id: OWNERS[shopId], type: 'INVENTORY', action: 'TRANSFER_IN',
          entity_type: 'inventory', entity_id: row.id, quantity,
          notes: keyedNote('audit-logs.NOTE_ORDER_RECEIVED', { orderId }),
        },
        at,
      );
    }
  };

  // ── Sales ──────────────────────────────────────────────────────────────────
  const ringUpSale = (shopId: number, daysAgo: number): void => {
    const hour = int(9, 20);
    const createdAt = daysAgo === 0 ? new Date(now.getTime() - int(20, 170) * 60_000) : atHour(daysAgo, hour, int(0, 59));
    const canSell = (row: InventoryRow): boolean => row.current_quantity > floors.get(row.id)!;

    const lines: InventoryRow[] = [];
    const fast = fastSellers.get(shopId)!.filter(canSell);
    if (fast.length > 0 && random() < 0.6) lines.push(pick(fast));
    lines.push(...shuffled(sellableRows.get(shopId)!.filter(canSell)).slice(0, int(1, 3)));
    if (lines.length === 0) return;

    const receiptId = t.receipts.length + 1;
    const staff = [...EMPLOYEES[shopId], OWNERS[shopId]];
    const createdBy = pick(staff);
    const sessionId = sessionIds.get(`${shopId}:${daysAgo}:${hour < SHIFT_CHANGE_HOUR ? 1 : 2}`) ?? null;

    const roll = random();
    const isCancelled = roll < 0.04;
    const isFree = !isCancelled && roll < 0.08;
    const isCredit = !isCancelled && !isFree && roll < 0.2;
    const cancelledAt = isCancelled ? new Date(createdAt.getTime() + HOUR) : null;
    const cancelReason = isCancelled ? 'Customer returned the items' : null;
    const customerId = isCredit ? pick(customersByShop.get(shopId)!) : null;

    let totalCents = 0;
    for (const row of lines) {
      const quantity = Math.min(int(1, 4), row.current_quantity - floors.get(row.id)!);
      const before = row.current_quantity;
      row.current_quantity -= quantity;
      const priceCents = toCents(Number(row.sale_price));
      totalCents += priceCents * quantity;

      t.receipt_items.push({
        id: t.receipt_items.length + 1,
        receipt_id: receiptId,
        inventory_id: row.id,
        product_id: row.product_id,
        quantity,
        quantity_before: before,
        quantity_after: row.current_quantity,
        price: row.sale_price,
        cost_price: row.avg_cost,
      });
      audit(
        {
          shop_id: shopId, user_id: createdBy, type: 'INVENTORY', action: 'ADJUSTMENT',
          entity_type: 'inventory', entity_id: row.id, receipt_id: receiptId, quantity: -quantity,
        },
        createdAt,
      );

      if (isCancelled) {
        row.current_quantity += quantity;
        audit(
          {
            shop_id: shopId, user_id: OWNERS[shopId], type: 'INVENTORY', action: 'CANCELLED',
            entity_type: 'inventory', entity_id: row.id, receipt_id: receiptId, quantity, notes: cancelReason,
          },
          cancelledAt!,
        );
      }
    }

    t.receipts.push({
      id: receiptId,
      shop_id: shopId,
      created_by: createdBy,
      notes: isFree ? 'Goodwill sample' : null,
      is_free: isFree,
      is_cancelled: isCancelled,
      cancelled_at: cancelledAt,
      cancelled_by: isCancelled ? OWNERS[shopId] : null,
      cancel_reason: cancelReason,
      customer_id: customerId,
      shift_session_id: sessionId,
      created_at: createdAt,
    });

    const drawer = sessionId === null ? undefined : sessionCash.get(sessionId);
    if (isCredit) {
      const downPayment = random() < 0.5 ? Math.floor(totalCents * 0.3) : 0;
      const payments: Payment[] = downPayment > 0 ? [{ cents: downPayment, at: createdAt, sessionId }] : [];
      if (drawer) drawer.collections += downPayment;
      addDebt(
        {
          creditor_shop_id: shopId, debtor_type: 'CUSTOMER', customer_id: customerId, receipt_id: receiptId,
          note: `Receipt #${receiptId}`,
        },
        totalCents, createdAt, createdBy,
        [...payments, ...followUpPayments(totalCents - downPayment, createdAt, 0.35)],
      );
    } else if (drawer && !isFree && !isCancelled) {
      drawer.sales += totalCents;
    }
  };

  // ── Run the history forward, day by day ────────────────────────────────────
  for (let daysAgo = HISTORY_DAYS; daysAgo >= 0; daysAgo--) {
    ORDER_PLAN.filter((plan) => plan.daysAgo === daysAgo).forEach(placeOrder);
    deliveries.filter((delivery) => delivery.dueDay === daysAgo).forEach(deliver);
    for (const shopId of RETAIL_SHOPS) {
      if (daysAgo === 0 || random() < 0.85) ringUpSale(shopId, daysAgo);
    }
  }

  // ── Close every drawer, now the day's cash is known ────────────────────────
  (t.shift_sessions as (Row & { id: number })[]).forEach((session, index) => {
    const cash = sessionCash.get(session.id)!;
    const expected = OPENING_FLOAT_CENTS + cash.sales + cash.collections;
    const difference = index % 9 === 4 ? -int(1, 6) * 50 : index % 17 === 3 ? int(1, 3) * 50 : 0;

    Object.assign(session, {
      opening_float: fromCents(OPENING_FLOAT_CENTS),
      counted_cash: fromCents(expected + difference),
      expected_cash: fromCents(expected),
      cash_difference: fromCents(difference),
      cash_sales: fromCents(cash.sales),
      cash_collections: fromCents(cash.collections),
      cash_payouts: '0.00',
      notes: difference === 0 ? null : 'Drawer count differed from expected',
    });

    const base = { shop_id: session.shop_id, user_id: session.user_id, type: 'SHIFT', entity_type: 'shift_session', entity_id: session.id };
    audit({ ...base, action: 'CLOCK_IN', amount: OPENING_FLOAT_CENTS / 100 }, session.opened_at as Date);
    audit({ ...base, action: 'CLOCK_OUT', amount: difference / 100, notes: session.notes }, session.closed_at as Date);
  });

  // ── Low-stock alerts match what the shortages pages will show ──────────────
  for (const row of t.inventory as InventoryRow[]) {
    if (row.current_quantity <= row.low_stock_threshold) {
      const productName = productById.get(row.product_id)!.name;
      notify(row.shop_id, 'LOW_STOCK', { productName }, new Date(now.getTime() - int(1, 30) * HOUR), false);
    }
  }

  return t;
}

function newClient(): pg.Client {
  const { DATABASE_HOST: host, DATABASE_USERNAME: user, DATABASE_PASSWORD: password, DATABASE_NAME: database } = process.env;

  // No localhost fallback, unlike seed.ts: a demo with missing config must stop.
  if (!host || !user || !password || !database) {
    throw new Error('Demo: DATABASE_HOST, DATABASE_USERNAME, DATABASE_PASSWORD and DATABASE_NAME are all required');
  }

  return new pg.Client({
    host,
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    user,
    password,
    database,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
  });
}

async function requireMarker(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ marker: string | null }>(
    'SELECT to_regclass($1) AS marker',
    [`public.${MARKER_TABLE}`],
  );
  if (rows[0].marker === null) {
    throw new Error(`Demo: refusing to run, table "${MARKER_TABLE}" is missing, so this is not the demo database`);
  }
}

/**
 * Runs before migrations, so a service pointed at the wrong database stops
 * before anything is written to it.
 */
export async function assertDemoDatabase(): Promise<void> {
  const secret = process.env.JWT_SECRET ?? '';
  if (secret.includes('${') || secret.length < 32) {
    throw new Error('Demo: JWT_SECRET must be a real secret of at least 32 characters');
  }
  if (process.env.RUN_SEED === 'true') {
    throw new Error('Demo: RUN_SEED must not be set, it would load the real catalog');
  }
  if (process.env.SMTP_HOST) {
    throw new Error('Demo: SMTP_HOST must not be set, the demo never sends email');
  }
  // Production runs on Railway. Stop here rather than even open a connection.
  if (/railway|rlwy/i.test(process.env.DATABASE_HOST ?? '')) {
    throw new Error('Demo: DATABASE_HOST points at Railway, which hosts production');
  }
  if ((process.env.CRON_SECRET ?? '').length < 16) {
    console.warn('Demo: CRON_SECRET is unset or short, so the daily reset route will refuse every call');
  }

  const client = newClient();
  await client.connect();
  try {
    await requireMarker(client);
  } finally {
    await client.end();
  }
}

async function insertRows(client: pg.Client, table: string, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const chunkSize = 500;

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const params: unknown[] = [];
    const values = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        params.push(row[column] ?? null);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')}`, params);
  }

  // Rows carry explicit ids, so point the sequence past them or the first row a
  // visitor creates would collide.
  if ('id' in rows[0]) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT MAX(id) FROM ${table}))`,
      [table],
    );
  }
}

const INVARIANTS: [rule: string, violationsSql: string][] = [
  [
    'every order at SHIPPED or later has exactly one live debt',
    `SELECT o.id FROM orders o
      WHERE o.status IN ('SHIPPED', 'RECEIVED', 'COMPLETED')
        AND (SELECT COUNT(*) FROM debts d WHERE d.order_id = o.id AND d.status <> 'CANCELLED') <> 1`,
  ],
  [
    'no order before SHIPPED, or cancelled, has a debt',
    `SELECT o.id FROM orders o JOIN debts d ON d.order_id = o.id
      WHERE o.status IN ('PENDING', 'PROCESSING', 'CANCELLED')`,
  ],
  [
    'an order debt equals the order total',
    `SELECT d.id FROM debts d
       JOIN (SELECT order_id, SUM(quantity * price) AS total FROM order_items GROUP BY order_id) oi
         ON oi.order_id = d.order_id
      WHERE d.total_amount <> oi.total`,
  ],
  [
    'paid_amount equals the sum of payments',
    `SELECT d.id FROM debts d
       LEFT JOIN debt_payments p ON p.debt_id = d.id
      GROUP BY d.id
     HAVING d.paid_amount <> COALESCE(SUM(p.amount), 0)`,
  ],
  [
    'debt status agrees with paid_amount',
    `SELECT id FROM debts
      WHERE status <> CASE WHEN paid_amount >= total_amount THEN 'PAID'
                           WHEN paid_amount > 0 THEN 'PARTIAL'
                           ELSE 'OPEN' END`,
  ],
  ['no inventory quantity is negative', 'SELECT id FROM inventory WHERE current_quantity < 0'],
  [
    'receipt lines add up',
    'SELECT id FROM receipt_items WHERE quantity_after <> quantity_before - quantity',
  ],
  ['no shift is left open', `SELECT id FROM shift_sessions WHERE status <> 'CLOSED'`],
  ['nothing is dated in the future', 'SELECT id FROM receipts WHERE created_at > NOW()'],
  ['no real account survives the reset', `SELECT id FROM users WHERE email NOT LIKE '%@example.com'`],
];

async function assertInvariants(client: pg.Client): Promise<void> {
  for (const [rule, sql] of INVARIANTS) {
    const { rowCount } = await client.query(sql);
    if (rowCount) {
      throw new Error(`Demo seed broke a rule (${rowCount} rows): ${rule}`);
    }
  }
}

/** Empties the demo database and rebuilds it. All or nothing: one transaction. */
export async function resetDemoData(): Promise<void> {
  if (process.env.DEMO_MODE !== 'true') {
    throw new Error('Demo: refusing to reset, DEMO_MODE is not true');
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const client = newClient();
  await client.connect();

  try {
    // Checked here as well as at boot, so this function is safe on its own.
    await requireMarker(client);

    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '15s'`);

    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT (tablename = ANY($1))`,
      [PRESERVED_TABLES],
    );
    const tableList = rows.map((row) => `"${row.tablename}"`).join(', ');
    await client.query(`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`);

    const tables = buildDemoData(new Date(), passwordHash);
    for (const [table, tableRows] of Object.entries(tables)) {
      await insertRows(client, table, tableRows);
    }

    await assertInvariants(client);
    await client.query('COMMIT');

    console.log(
      `Demo data reset: ${tables.orders.length} orders, ${tables.receipts.length} receipts, ` +
        `${tables.products.length} products, ${tables.debts.length} debts`,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

/**
 * Boot-time setup: migrations, then demo data only if none is there yet.
 *
 * Serverless hosts start an instance on a visitor's first request and stop it
 * when idle, so resetting on every boot would wipe what visitors were doing.
 * The daily reset comes from the cron route instead. DEMO_RESET_ON_BOOT=true
 * restores reset-on-boot, which suits local testing.
 *
 * Instances that start together queue on an advisory lock, so only the first
 * runs the migrations and the seed; the rest find the work already done.
 */
export async function prepareDemoDatabase(runMigrations: () => Promise<void>): Promise<void> {
  const lock = newClient();
  await lock.connect();

  try {
    await requireMarker(lock);
    await lock.query('SELECT pg_advisory_lock($1)', [BOOT_LOCK_KEY]);

    await runMigrations();

    const { rows } = await lock.query<{ seeded: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM users WHERE email = $1) AS seeded',
      [DEMO_ADMIN_EMAIL],
    );
    if (!rows[0].seeded || process.env.DEMO_RESET_ON_BOOT === 'true') {
      await resetDemoData();
    } else {
      console.log('Demo data already present, keeping it');
    }
  } finally {
    // Ending the session releases the advisory lock as well.
    await lock.end();
  }
}
