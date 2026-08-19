# Supplier Invoice Items (Buy → Stock In One Call) — Implementation Log

> **Status: DONE.** Built, migrated, and verified end to end against real
> data on the dev database — a 36-check regression suite, all passing. This
> document is written after the fact: it records what was actually built and
> actually tested, not a plan for what would be built.

---

## Overview

The [supplier debts feature](18-supplier-debts.md) records what a shop
**owes**. It had nothing to say about what the shop actually **bought** for
that money. So the real-world workflow took two disconnected trips through
the app:

1. `POST /suppliers/:id/debts` — record the 1,420.00 bill.
2. `POST /inventory/stock-in`, once per product — put the goods on the shelf.

Nothing tied the two together. Step 2 could be forgotten, done twice, or
keyed with different costs than the bill said, and the ledger and the cost
basis would disagree with nothing in the data to say which one was wrong.

This feature adds an optional `items[]` to the bill. When present, every line
is stocked into the shop's inventory at its invoice unit cost, **inside the
same transaction that raises the payable**.

### Example

A shop buys from a supplier: 21 units of *gff* at 50.00, 10 of *بسكوتة 5000*
at 20.00, 5 of *rubbi* at 34.00 — 1,420.00 total, 400.00 paid on delivery.

One `POST`, and:

- a payable exists: `total 1420.00`, `paid 400.00`, `remaining 1020.00`, `PARTIAL`
- all three products are on the shelf, each at its real acquisition cost
- `gff`'s moving average moved from 44.0000 to **46.5200**, blending the new batch
- three `STOCK_IN` audit rows name the supplier and invoice number

---

## Decisions Already Made

| # | Question | Decision |
|---|---|---|
| 1 | New endpoint, or extend the existing one? | **Extend `POST /suppliers/:id/debts`.** A bill and its goods are one event; two endpoints would mean two transactions and the exact desync this feature exists to prevent. |
| 2 | Are items required? | **No.** A bill with no items stays a plain payable — plenty of supplier invoices are for services, rent or a delivery charge, and forcing a product line onto those would be a lie in the ledger. |
| 3 | Can a line create a new product? | **No — two-step.** The client calls `POST /products` first and sends the returned id. Keeps name/barcode uniqueness, category accessibility, and `LOCAL`/`WAREHOUSE` source derivation in exactly one place. See "Rejected alternative" below. |
| 4 | Must `items[]` sum to `totalAmount`? | **Yes, exactly.** A bill whose lines disagree with its own total means one of the two was mistyped. Letting it through would leave the ledger and the cost basis permanently out of step, silently. |
| 5 | Is `unitCost` optional, like `StockInDto.unitCost`? | **No — required and `> 0`.** An invoice states its prices by definition; an inherited cost could not be reconciled against the total; and a zero-cost line would drag the moving average down as though the goods were free. |
| 6 | Free stock (samples, promo units)? | **Not on a bill.** Nothing is owed for free goods, so there is no payable to record. Use `POST /inventory/stock-in` with an explicit `unitCost: 0`, which still supports it. |
| 7 | Cancelling an itemised bill? | **Refused.** Cancelling would void the money and leave the goods. The stock has to be removed first, by a deliberate inventory adjustment. |
| 8 | New bill against a deactivated supplier? | **Refused** — almost always a mis-selected id. Reads and payments stay open on a deactivated supplier, so history stays legible and existing balances stay payable. |

### Rejected alternative: inline product creation

An item could have accepted *either* a `productId` *or* a
`newProduct: { name, categoryId, salePrice }` block, creating the product
inside the same transaction. Better UX — one call, all-or-nothing.

It was rejected for this iteration because `ProductsRepository.insert` and
its uniqueness pre-checks are not client-aware (they use `this.db.query`, so
they cannot join a caller's transaction), and duplicating the product rules
into the suppliers module to avoid that refactor would put name/barcode
uniqueness in two places. The two-step flow costs the client one extra
request and keeps those rules in one place.

The cost of the two-step choice, which the frontend has to absorb: if the
invoice is then rejected, any products created in step 1 are left behind and
the user has to clean them up.

---

## Schema

`src/database/migrations/05-SupplierDebtItems.sql`. Applied to the dev
database; re-running the runner reports no pending migrations.

### `supplier_debt_items` (new)

| Column | Notes |
|---|---|
| `debt_id` | the payable, `ON DELETE CASCADE` |
| `product_id` | `ON DELETE RESTRICT` — see below |
| `inventory_id` | which inventory row the units landed in |
| `quantity` | `CHECK (quantity > 0)` |
| `unit_cost` | `DECIMAL(15,4)`, `CHECK (unit_cost > 0)` |
| `line_total` | `GENERATED ALWAYS AS (ROUND(quantity * unit_cost, 2)) STORED` |

**`product_id` is `RESTRICT`, not `CASCADE`** — deliberately unlike
`order_items` and `receipt_items` (`00-InitialSchema.sql:138,169`). Those
record a movement; this records money that left the till, and the same
reasoning that made `debts.supplier_id` RESTRICT applies. Products are
soft-deleted via `is_active` anyway, so nothing legitimate is blocked.

**`inventory_id` is stored** rather than re-derived, mirroring
`receipt_items.inventory_id` for the outgoing direction. It is what a future
cancel-and-restock path would need to take units back out of the right row.

**`line_total` is generated**, not passed in, so a line can never disagree
with its own arithmetic. The service still sums the lines in bigint minor
units before writing and rejects a total that does not reconcile — the
generated column guarantees consistency, not correctness of intent.

### Indexes

- `idx_supplier_debt_items_debt` — the lines of one bill.
- `idx_supplier_debt_items_debt_product` (UNIQUE) — one line per product per
  invoice. Two lines for the same product would blend the moving average
  twice from a stale base and leave "what did this invoice cost per unit"
  with no single answer. The service rejects the duplicate first; the index
  guards against a concurrent insert.

---

## How Stocking Works

The invoice route makes **the same call the orders flow makes on delivery** —
`InventoryRepository.upsertStockIn` (`orders.service.ts:312`). No second cost
engine was written. Three situations, all handled by that one statement:

| Situation | What happens |
|---|---|
| Shop already stocks the product | `ON CONFLICT DO UPDATE` — weighted moving average: `(qty × avg + inQty × inCost) / (qty + inQty)`, rounded to 4dp |
| Product exists, shop has no inventory row | `INSERT` branch — row seeded with `avg_cost` = the invoice unit cost, `sale_price` = `products.price` |
| Row exists but quantity is 0 | Denominator is just the incoming quantity, so `avg_cost` resets cleanly to the new price — no stale average contaminates the batch |

Because `unitCost` is always stated on an invoice line, the `COALESCE`
fallback to `products.cost_price` in the INSERT branch is never reached from
this path.

### Verified arithmetic (dev database, real rows)

| Product | Before | Bought | After | Check |
|---|---|---|---|---|
| `gff` (146) | 29 @ 44.0000 | 21 @ 50.00 | **50 @ 46.5200** | (1276+1050)/50 |
| `gff` again | 50 @ 46.5200 | 50 @ 30.00 | **100 @ 38.2600** | (2326+1500)/100 |
| `بسكوتة 5000` (127) | 0 @ 43.0000 | 10 @ 20.00 | **10 @ 20.0000** | stale average discarded |
| `rubbi` (147) | no row | 5 @ 34.00 | **5 @ 34.0000**, price 40.00 | seeded from catalog |

---

## Order of Operations

Everything rejectable without a database write is rejected **before** the
transaction opens, so a bad line never holds inventory row locks while the
request unwinds:

1. `requireOwnSupplier` — shop scope; another shop's supplier is a 404.
2. Supplier must be `is_active`.
3. Invoice-number pre-check (the partial unique index remains the real guard).
4. `paidAmount <= totalAmount`.
5. `resolveItems`: no duplicate products → every `unitCost > 0` → every
   product exists and is in scope (one batched query, not N) → lines sum
   exactly to `totalAmount` in bigint minor units.

Then, in **one** transaction:

1. Insert the debt.
2. Per line, in ascending `productId` order: `upsertStockIn` → insert the
   line row → write a `STOCK_IN` audit row.
3. Apply `paidAmount`, if any.

Lines are sorted by product id so two invoices touching overlapping products
take the inventory row locks in the same order and cannot deadlock.

The response re-fetches after commit — the in-transaction debt object still
shows `paid_amount` from before the payment was applied — and returns the
lines with their resulting `avg_cost`, so the client can show what the
purchase did to the cost basis without a second round trip.

---

## Interaction With Existing Features

### Cancelling a payable

`POST /debts/:id/cancel` previously just flipped the status. With stock
attached that would erase the money and leave the goods, so
`cancelSupplierDebtForUser` now refuses when the bill has lines
(`debt.HAS_STOCKED_ITEMS`).

The check reaches `supplier_debt_items` from `DebtsRepository.hasStockedItems`
rather than going through `SuppliersModule` — which imports `DebtsModule`, so
the alternative is a circular dependency for a single existence check.

The guard is **narrow** in one direction and **absolute** in the other: a bill
with no items still cancels normally (verified), but a bill *with* items can
never be cancelled. The check is on the existence of line rows, and an
inventory adjustment does not remove those — so there is no sequence of user
actions that unblocks it. See limitation 3.

### Payments, summaries, aging

Untouched. An itemised bill is an ordinary payable to the whole payment
engine — FIFO allocation, reversal, aging buckets and the payables summary
all work on it with no changes. Verified by paying an itemised bill down to
`PAID` through the existing `POST /suppliers/:id/payments`.

### Audit log

Each line writes an `INVENTORY` / `STOCK_IN` row against the inventory id,
with `quantity`, the line total as `amount`, and a localized note naming the
supplier (`NOTE_SUPPLIER_INVOICE` with the invoice number, or
`NOTE_SUPPLIER_PURCHASE` without). Reads back correctly in both languages.

The bill itself still writes no audit row on creation — unchanged from
`18-supplier-debts.md`; only payments do.

---

## Verified on the Dev Database

A 36-check regression suite over HTTP against a running server: **36 passed,
0 failed.** Every test wrote through the real API with a real JWT; all test
data was rolled back afterwards and the inventory rows restored.

**Rejections — and nothing written by any of them** (`supplier_debt_items`
still empty, inventory untouched, verified after the whole rejection block):

| Case | Result |
|---|---|
| Lines don't sum to total | `400` — names both figures |
| Same product twice | `400 supplier.DUPLICATE_ITEM` |
| `unitCost` `"0"` and `"0.00"` | `400 supplier.ITEM_COST_INVALID` — names the product |
| Product private to another shop | `403 inventory.PRODUCT_NOT_IN_SCOPE` |
| Product does not exist | `404` — names the id |
| Deactivated supplier | `400 supplier.INACTIVE` |
| `paidAmount > totalAmount` | `400 supplier.PAID_EXCEEDS_TOTAL` |
| Malformed money (`10.999`), empty `items[]`, negative quantity | `400` validation |
| EMPLOYEE | `403` |
| Another shop's owner | `404`, not `403` — supplier existence is not leaked |

**Happy paths:** 3-line bill creating `PARTIAL` with correct remaining; all
three stocking situations correct; `line_total` generated; 3 audit rows;
`GET items`; duplicate invoice number `409`; re-blending on a second
delivery; service bill with no items returning `items: []`.

**Guards:** cancel refused on an itemised bill, allowed on an item-free one;
payment settles an itemised bill to `PAID`; reads on a deactivated supplier
still `200`.

**i18n:** total mismatch, zero unit cost, and inactive supplier all resolve
in Arabic.

**Defense in depth:** a direct `INSERT` with `unit_cost = 0` is refused by
the column constraint, not just by the service.

---

## Bugs Found and Fixed During Build

1. **Zero-cost lines were initially allowed** (`CHECK (unit_cost >= 0)`, and
   an explicit "0 is legal for free stock" in the DTO), mirroring
   `StockInDto`'s tri-state. Wrong here: a free line contributes 0 to the
   total but still drags the moving average down. Tightened to `> 0` at both
   the service (translatable message naming the product) and the column
   (`CHECK (unit_cost > 0)`).

2. **New bills could be raised against a deactivated supplier.** Pre-existing
   behaviour — `requireOwnSupplier` only ever checked shop scope. Found while
   testing, because the first supplier picked from the dev data happened to
   be deactivated. Fixed in `createDebt` only, *not* in `requireOwnSupplier`,
   which also backs the read and payment paths.

---

## Files Touched

```
src/database/migrations/05-SupplierDebtItems.sql   NEW

src/suppliers/
├── entities/supplier-debt-item.entity.ts          NEW  SupplierDebtItem, SupplierDebtItemDetail
├── dto/create-supplier-debt.dto.ts                + SupplierDebtItemDto, items[]
├── repositories/suppliers.repository.ts           + insertDebtItem, findDebtItems
├── services/suppliers.service.ts                  + resolveItems, findDebtItems,
│                                                    is_active guard, stocking loop
├── controllers/suppliers.controller.ts            + GET :id/debts/:debtId/items
└── suppliers.module.ts                            + InventoryModule, AuditLogsModule

src/inventory/repositories/inventory.repository.ts + findProductsForStockIn (batch)
src/debts/repositories/debts.repository.ts         + hasStockedItems
src/debts/services/debts.service.ts                cancel refuses a bill with lines

i18n/{en,ar}/supplier.json     + ITEMS_TOTAL_MISMATCH, DUPLICATE_ITEM, INACTIVE, ITEM_COST_INVALID
i18n/{en,ar}/debt.json         + HAS_STOCKED_ITEMS
i18n/{en,ar}/audit-logs.json   + NOTE_SUPPLIER_INVOICE, NOTE_SUPPLIER_PURCHASE
i18n/{en,ar}/validation.json   + ARRAY_MAX_SIZE
```

---

## Known Limitations

### 1. Selling price never moves

`sale_price` is seeded once on the first stock-in and never touched again by
any stocking path. When a supplier raises prices, `avg_cost` climbs and
`sale_price` stays put, silently eating margin — in testing, `gff`'s cost
went 44.00 → 46.52 → 38.26 while its price sat at 63.97 throughout.

The `items[]` response carries `avg_cost` per line **precisely so the client
can prompt for a price update**. Nothing does that yet. This is the most
likely next piece of work.

### 2. No low-stock notification on invoice stock-in

`InventoryService.stockIn` fires `notifyLowStock` after commit; this path
does not. Adding stock only moves quantity toward the threshold, and the
notification would cost an extra query per line. The gap is a small delivery
that leaves an item still below its threshold — no alert is raised.

### 3. Cancel is a dead end — an itemised bill can never be voided

An itemised bill entered by mistake **cannot be cancelled, ever**, under this
build. `hasStockedItems` tests for line rows, not for stock on hand, so
adjusting the inventory away does not unblock it. The user can correct the
quantities; the bill stays on the supplier's account and remains payable.

The first cut of this shipped with an error message reading *"Remove the
stock with an inventory adjustment first"* — which promised a recovery path
that does not exist. The message now states the hard stop plainly and says
what the user can actually do instead.

The real fix is **cancel-and-restock**, designed but not built:

- One transaction. Cancel the debt first, conditionally on
  `status <> 'CANCELLED'` (which `cancelById` already does); only run the
  deductions if that actually flipped a row, so a double-cancel cannot remove
  units twice.
- Refuse the whole cancellation if any line's quantity is no longer on hand —
  the stock was sold — naming the product and what remains, matching
  `inventory.NEGATIVE_STOCK`.
- Remove units **cost-neutrally**, at the current `avg_cost`, matching the
  documented rule for `adjust` (`inventory.service.ts:149-154`). A moving
  average cannot be cleanly un-blended once later deliveries have moved it,
  and pretending otherwise produces a worse number than leaving it alone.
- Keep the line rows — the cancelled bill still records what was on it — and
  write one `ADJUSTMENT` audit row per line naming the voided invoice.
- Payments are unaffected: a cancelled bill with `paid_amount > 0` stays
  "refund due", the existing receivables rule.

Until then, the mitigation is at the UI layer: because the mistake is
unrecoverable, the confirm step before submitting an itemised bill has to
carry real weight.

### 4. Tax, shipping and discounts have nowhere to go

Lines must sum to `totalAmount` **exactly**. An invoice with a delivery
charge or VAT on top cannot be entered as one itemised bill; it has to be
split, or the charge folded into unit costs. If this becomes real, the fix is
explicit optional `taxAmount` / `shippingAmount` fields folded into the
expected total — *not* loosening the check to `<=`.

### 5. A second stock-in entry point now exists

Any future rule that belongs on "stock arriving" — most immediately the
`is_orderable` promotion contract — has to fire here too, not only in
`InventoryService.stockIn`.
