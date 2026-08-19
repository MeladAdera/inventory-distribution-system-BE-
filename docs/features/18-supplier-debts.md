# Supplier Debts (Accounts Payable) — Implementation Log

> **Status: DONE.** Built, migrated, and verified end to end against real
> data on the dev database across 11 build steps. This document is written
> after the fact — it records what was actually built and actually tested,
> not a plan for what would be built.

---

## Overview

The existing [debts feature](17-debts.md) tracks money **coming in**: a shop
owes the warehouse for an order, a customer owes a shop for a receipt. It has
no idea about money **going out** — what a shop (or the warehouse itself)
owes an outside supplier for goods bought on credit.

This feature adds that missing half. A shop can record a supplier's bill —
say 150.00 — pay part of it now — say 100.00 — and the remaining 50.00 stays
tracked as a debt, payable later, in parts, exactly like a customer debt
works today just running in the opposite direction.

There is no source document behind a supplier bill. An order debt is raised
by an order shipping; a customer debt is raised by a credit sale. A supplier
bill is typed in directly — nothing else in the system creates it.

### Example

1. A shop owner buys goods worth **150.00** from a supplier.
2. They pay **100.00** on delivery.
3. `POST /suppliers/:id/debts` records a debt: `total_amount 150.00`,
   `paid_amount 100.00`, `remaining 50.00`, `status PARTIAL`.
4. A week later they pay the last 50.00. Status becomes `PAID`.

---

## Decisions Already Made

| # | Question | Decision |
|---|---|---|
| 1 | New payable tables, or reuse `debts`? | **Reuse `debts`.** See "Why reuse" below — this was the single biggest design fork in the feature and was revisited once mid-build before settling. |
| 2 | Who can have suppliers? | Every shop, **including the warehouse** — the warehouse is just a `shops` row with `type = 'WAREHOUSE'`, so it gets its own suppliers for free with no special-case code. |
| 3 | Cross-shop visibility for admin? | **None.** Unlike order-debts (where the admin sees every shop), a shop's suppliers are its own business — same rule as `customers`, extended to cover the warehouse too. |
| 4 | Can an EMPLOYEE manage suppliers or pay them? | **No.** Owning money to a supplier is an owner-level decision, same reasoning as why profit reports are owner-only. |
| 5 | `paidAmount` default when recording a bill? | **`0`** (fully on credit) — the opposite default from a receipt's `paidAmount`, which defaults to the full total. A supplier-bill endpoint's whole purpose is usually to record what's still owed. |
| 6 | Payment allocation with no `debtId`? | **FIFO**, oldest bill first — identical rule to customer payments. |
| 7 | Cancelling a bill entered by mistake? | **Cancel by id** (`POST /debts/:id/cancel`) — the existing `cancelDebt` only knows how to look a debt up by its order/receipt, which a supplier bill doesn't have. |

### Why reuse `debts`

Two designs were seriously considered:

**New tables** (`supplier_debts`, `supplier_debt_payments`) would have been
structurally safe — a supplier bill could never physically appear in a
receivables report, because that report's SQL would never touch the new
table. The cost: a second, mostly-duplicate payment engine (locking, FIFO,
reversal, aging) instead of reusing the one that already works.

**Reuse `debts`** gets the whole payment engine for free — `addPayment`,
`reversePayment`, the FIFO allocator, the aging buckets — all unmodified.
The cost: every existing query that reads `debts` and assumes "this is money
owed to us" has to be checked and fixed by hand, or a supplier bill would
silently leak into a receivables total.

Reuse was chosen. Section "Interaction With Existing Features" below is the
receipt for that decision — it lists every place that had to be fixed to pay
for it, and how each was verified.

---

## Schema

`src/database/migrations/04-SupplierDebts.sql`. Applied to the dev database;
existing `debts` rows (21 at the time) all backfilled to `creditor_type =
'SHOP'` with zero manual migration and zero table rewrite.

### `suppliers` (new)

Shaped exactly like `customers`: shop-scoped, soft-deleted, phone unique per
shop only while active.

| Column | Notes |
|---|---|
| `shop_id` | owner shop, `ON DELETE CASCADE` |
| `name` | **not unique** |
| `phone` | unique per shop, scoped to `is_active = TRUE` |
| `is_active` | soft delete |

### `debts` — three new columns

| Column | Notes |
|---|---|
| `creditor_type` | `SHOP` \| `SUPPLIER`. `NOT NULL DEFAULT 'SHOP'` — every existing row is a receivable, so the default backfills them for free. |
| `supplier_id` | set only on a payable |
| `invoice_no` | set only on a payable; free-text reference from the supplier |

`creditor_shop_id` became **nullable** — a payable has no creditor shop, the
creditor is an outside supplier.

### The three-shape constraint

`chk_debts_debtor_shape` was replaced by `chk_debts_party_shape`, which now
allows exactly three row shapes instead of two:

1. Order receivable: `creditor_type SHOP`, `debtor_type SHOP`, `order_id` set, `supplier_id`/`invoice_no` NULL.
2. Receipt receivable: `creditor_type SHOP`, `debtor_type CUSTOMER`, `receipt_id` set.
3. Supplier payable: `creditor_type SUPPLIER`, `debtor_type SHOP`, `supplier_id` set, `order_id`/`receipt_id`/`creditor_shop_id` all NULL.

Both receivable arms keep `creditor_shop_id IS NOT NULL` on purpose — this
is load-bearing. `chk_debts_no_self_debt` is
`debtor_shop_id IS DISTINCT FROM creditor_shop_id`, and two `NULL`s are
**not** distinct, so a receivable that lost its creditor would fail that
check with a confusing, unrelated-looking error.

### New indexes

- `idx_debts_supplier` — "what do we owe this supplier", mirrors `idx_debts_customer`.
- `idx_debts_debtor_shop_creditor_type` — serves the shop-summary payables query below.
- `idx_debts_supplier_invoice_unique` — a payable's closest equivalent to "one live debt per source": the same supplier can't have two live bills under the same invoice number, scoped to non-`CANCELLED`.

### Verified on the dev database

| Test | Result |
|---|---|
| All 21 pre-existing `debts` rows | passed the new 3-arm constraint with zero changes |
| Re-running the migration a second time | no-op, `"No pending migrations"` |
| A hand-written row with `creditor_type SUPPLIER` + `order_id` set | rejected by `chk_debts_party_shape` |
| Same invoice number typed twice for one supplier | rejected — `409 supplier.INVOICE_TAKEN` (see "Bugs found" below) |

---

## Interaction With Existing Features

This was the risky part — every place that already reads `debts` and had to
be taught about the new row shape without breaking what it already did.

### The four leaks

Every query in the codebase that touches `debts` was audited. Four were
real leaks — places where, without a fix, a supplier payable would have
silently counted as money owed **to** the shop instead of money owed **by**
it:

1. `getSummary`/`runSummary` — powers `GET /debts/summary` and
   `GET /analytics/receivables`.
2. `getAging` — powers the receivables aging report.
3. `buildFilters`'s debtor-type filter — a payable's `debtor_type` is
   `'SHOP'`, identical to an order debt's, so `?debtorType=SHOP` alone could
   no longer tell the two apart.
4. `getSummaryForShopAs('DEBTOR', ...)` — `owed_by_shop` on the shop summary
   specifically means "owed to the warehouse"; a supplier bill would have
   silently joined that number.

**The fix:** `DebtVisibility.creditorType` became a **required** field
(`'SHOP' | 'SUPPLIER' | 'ANY'`), not optional — an omitted filter is exactly
how a leak like this gets in. Every existing caller (`debts.controller.ts`,
`analytics.controller.ts`, `customers.service.ts`) was updated to pass
`'SHOP'` explicitly.

A fifth issue ran the opposite direction: `findPaginated`'s
`JOIN shops cs ON cs.id = d.creditor_shop_id` was an **inner** join — since
`creditor_shop_id` is `NULL` on every payable, that join would have silently
dropped supplier bills from any list that tried to include them. Changed to
`LEFT JOIN`, with a second `LEFT JOIN suppliers` and a `COALESCE` so the
"creditor name" column resolves to a supplier's name on a payable row.

### The fifth leak — the admin's cross-shop read (found 2026-08-15)

The audit above checked whether payables were landing on the **wrong side**
of a report. It did not check **whose** payables a caller could see, and
that turned out to be the bigger hole: a warehouse admin opening the
payables report saw every shop's supplier bills summed together with its
own.

The cause was a single early return in `visibilityFor`:

```ts
if (user.role === UserRole.WAREHOUSE_ADMIN) return { creditorType };  // no shopId
```

With no `shopId`, `buildFilters` never adds its shop condition, so the only
surviving `WHERE` on a payables query was `d.creditor_type = 'SUPPLIER'` —
every shop's bills.

That rule is correct for **receivables** and wrong for **payables**, and the
reason is worth stating because it is the whole principle: the warehouse is
the creditor on every order debt, so "all shops" there is really "every debt
I am a party to". A payable inverts the relationship — the warehouse is not
a party to what another shop owes its own suppliers, and the same "a shop's
suppliers are its own business" rule that governs the `/suppliers` routes
applies. The write path already knew this (`assertCanReverse` says so
outright: *"No global override for other shops' payables"*); only the read
path had missed it.

**Three fixes, all restating a rule that already existed elsewhere:**

1. `visibilityFor` — the admin's unscoped branch is now conditional on
   `creditorType === 'SHOP'`. `'ANY'` scopes too: it spans both sides, so it
   carries the payable risk with it.
2. `assertReadAccess` — a `SUPPLIER` branch dispatched **before** the admin
   override, checking `debtor_shop_id === user.shopId`, mirroring
   `assertCanReverse`. Without it, `GET /debts/:id` and `/:id/payments`
   would still read by id exactly what the list queries now hide. The
   employee half of the payable rule moved into that branch, since the
   receivables path below it can no longer see a payable at all.
3. `getShopSummary` — `owed_to_suppliers` is **omitted** for an admin
   reading another shop, not zeroed. A zero would read as "this shop owes
   its suppliers nothing"; absent reads as "not your business".
   `ShopDebtsSummary.owed_to_suppliers` became optional to match.

A fourth change came along with the first: `visibilityFor` used to fall back
to `shopId: user.shopId ?? undefined` for a user with no shop, and an absent
`shopId` means *no filter at all* — the same "hand them everything" failure
as the admin branch. Now refused with `debt.ACCESS_DENIED`, matching the
guard `assertReadAccess` already had.

**The lesson, and it is the same shape as the null-shop bugs below:** every
one of these was a rule that already existed correctly on the write path and
was simply never mirrored onto the read path. When a permission rule is
written in one place, the question to ask is not "is it right?" but "where
else does this same decision get made?"

### The null-shop permission bugs

Making `creditor_shop_id` nullable opened a class of bug that was
**structurally impossible before this change**: two places compared
`user.shopId` (which can be `null`, for a user with no shop) directly
against `debt.creditor_shop_id` with `===`. In JavaScript, `null === null`
is `true` — so without a fix, a user with no shop would have matched *every*
supplier payable in the system as "a party" to it.

- `assertReadAccess` — fixed by rejecting `user.shopId === null` up front.
- `assertCanReverse` — needed more than a null guard: a payable's
  `debtor_type` is `'SHOP'`, so it was falling into the order-debt branch
  and demanding `WAREHOUSE_ADMIN` — meaning a shop owner **could not** undo
  their own mistaken payment to their own supplier. Fixed with a dedicated
  branch: whoever paid the bill (the shop owner, or the admin for the
  warehouse's own bills) can reverse it, checked before the order-debt rule
  is reached.
- `logDebtEvent` — wrote `shop_id: debt.creditor_shop_id`, `NULL` for a
  payable, meaning the shop that made the payment could never see its own
  audit trail. Fixed to fall back to `debtor_shop_id`.

### Cancelling a bill has no source document

The existing `cancelDebt` finds a debt by its `order_id`/`receipt_id` —
both `NULL` on a payable, so it can never reach one. A parallel
`cancelDebtById` was added, reusing the exact same authority check as
reversing a payment (cancelling a part-paid bill is a strictly bigger action
than undoing one payment on it, so it can't have a weaker check), and
refusing to touch anything that isn't a payable — a receivable must still be
cancelled through its order or receipt, or that source document would keep
believing it has a live debt.

---

## Concurrency

Identical pattern to the existing debts engine, generalized rather than
duplicated:

`findOpenByCustomerForUpdate` became `findOpenByPartyForUpdate`, taking
`{ kind: 'CUSTOMER' | 'SUPPLIER'; id }`. The FIFO lock-then-allocate logic in
`addCustomerPayment` was extracted into a private `addPartyPayment`, shared
by both `addCustomerPayment` and the new `addSupplierPayment`.

**Why the two flows can't deadlock against each other:** `chk_debts_party_shape`
makes the two row sets provably disjoint — arm 2 forces `supplier_id` to
`NULL` on a receivable, arm 3 forces `customer_id` to `NULL` on a payable. A
customer collection and a supplier payment can never lock the same row, so
adding the second flow to the same `ORDER BY created_at, id` lock order
couldn't introduce a new deadlock path. (If a future feature ever needs to
lock both sides in one transaction — e.g. "settle everything for this
shop" — it would need to lock one ordered union, not call this method
twice.)

---

## Role Matrix

| Action | WAREHOUSE_ADMIN | SHOP_OWNER | EMPLOYEE |
|---|---|---|---|
| Manage suppliers (own shop only) | ✓ | ✓ | ✗ |
| Record a bill | ✓ | ✓ | ✗ |
| Pay a supplier | ✓ | ✓ | ✗ |
| Reverse a supplier payment | ✓ (own shop's bills) | ✓ (own shop's bills) | ✗ |
| Cancel a bill by id | ✓ | ✓ | ✗ |
| Payables reports | ✓ (own shop only) | ✓ (own shop only) | ✗ |
| Read a payable by id | ✓ (own shop's bills) | ✓ (own shop's bills) | ✗ |

No cross-shop visibility anywhere, for anyone — including the admin. This
is stricter than the receivables side, where the admin sees every shop's
order debts. The read path did not actually enforce this until the fifth
leak was fixed; the table describes the rule as it now behaves.

---

## Endpoints

| Method | Path | Roles |
|---|---|---|
| `POST` | `/suppliers` | ADMIN, OWNER |
| `GET` | `/suppliers` | ADMIN, OWNER |
| `GET` | `/suppliers/:id` | ADMIN, OWNER |
| `PATCH` | `/suppliers/:id` | ADMIN, OWNER |
| `DELETE` | `/suppliers/:id` | ADMIN, OWNER (soft delete; blocked if money is owed either direction) |
| `POST` | `/suppliers/:id/debts` | ADMIN, OWNER — record a bill |
| `GET` | `/suppliers/:id/debts` | ADMIN, OWNER |
| `GET` | `/suppliers/:id/summary` | ADMIN, OWNER |
| `POST` | `/suppliers/:id/payments` | ADMIN, OWNER — FIFO, or targets one bill via `debtId` |
| `POST` | `/debts/:id/cancel` | ADMIN, OWNER — payables only |
| `GET` | `/analytics/payables` | ADMIN, OWNER |
| `GET` | `/analytics/payables/aging` | ADMIN, OWNER |

Reused with **no new route**: `GET /debts/:id`, `GET /debts/:id/payments`,
and `POST /debts/:id/payments/:paymentId/reverse` already work correctly
against a payable — this is the direct payoff of reusing the existing
`debts` table.

`GET /shops/:id/debts/summary` gained a third block, `owed_to_suppliers`,
alongside the existing `owed_by_shop`/`owed_to_shop`. That block is present
**only for your own shop** — it is absent, not zero, when an admin reads
another shop's summary (see the fifth leak above).

---

## Request / Response Shapes

### `POST /suppliers/:id/debts`

```json
{ "totalAmount": "150.00", "paidAmount": "100.00", "invoiceNo": "INV-882", "note": "Delivery 12 Aug" }
```

`201`:
```json
{
  "id": 24,
  "creditor_shop_id": null,
  "creditor_type": "SUPPLIER",
  "debtor_type": "SHOP",
  "debtor_shop_id": 2,
  "supplier_id": 4,
  "invoice_no": "INV-882",
  "total_amount": "150.00",
  "paid_amount": "100.00",
  "remaining": "50.00",
  "status": "PARTIAL"
}
```

Like a credit sale, the debt stores the **whole bill**, not the unpaid
remainder — `paidAmount` is written as the first payment row, not folded
into a smaller starting total.

### `POST /suppliers/:id/payments`

```json
{ "amount": "50.00" }
```
or, targeting one bill:
```json
{ "amount": "50.00", "debtId": 24 }
```

Without `debtId`, response is an **array**, one entry per bill touched —
identical shape to `POST /customers/:id/payments`:
```json
[
  { "debt_id": 26, "receipt_id": null, "amount": "30.00", "status": "PAID",    "remaining": "0.00" },
  { "debt_id": 27, "receipt_id": null, "amount": "20.00", "status": "PARTIAL", "remaining": "20.00" }
]
```

### `POST /debts/:id/cancel`

```json
{ "reason": "entered by mistake" }
```

`400 debt.NOT_CANCELLABLE_BY_ID` if the target is actually a receivable.
`400 debt.ALREADY_CANCELLED` on a second attempt.

---

## DTOs

| DTO | File | Fields |
|---|---|---|
| `CreateSupplierDto` | `src/suppliers/dto/create-supplier.dto.ts` | `name` (required), `phone?`, `note?` |
| `UpdateSupplierDto` | `src/suppliers/dto/update-supplier.dto.ts` | partial of the above |
| `SupplierQueryDto` | `src/suppliers/dto/supplier-query.dto.ts` | `search?`, `hasDebt?`, `includeInactive?`, pagination |
| `CreateSupplierDebtDto` | `src/suppliers/dto/create-supplier-debt.dto.ts` | `totalAmount` (required), `paidAmount?` (defaults `0`), `invoiceNo?`, `note?` |
| `CreateSupplierPaymentDto` | `src/debts/dto/create-supplier-payment.dto.ts` | extends `CreateDebtPaymentDto` + `debtId?` |

`DebtQueryDto` (existing, shared) gained a `supplierId` filter, mirroring
the existing `customerId` one — used by `GET /suppliers/:id/debts`.

---

## Analytics Impact

`GET /analytics/payables` and `/payables/aging` needed almost no new
service code — the generic `DebtsService.getSummary`/`getAging` built for
receivables already accepted a `creditorType` parameter (that's the whole
point of the leak-fix work above). The routes just call them with
`'SUPPLIER'` instead of `'SHOP'`. `EMPLOYEE` is excluded from both, unlike
the receivables versions.

Scoping differs from receivables as well: both roles, **admin included**,
see their own shop only — see the fifth leak above for why the admin's
warehouse-wide receivables view does not carry over to this side.

Note that `?agingBucket=` drill-down does not work for payables the way it
does for receivables: `GET /debts` is pinned to `creditorType: 'SHOP'`, so
payables never appear in it. The per-supplier list
(`GET /suppliers/:id/debts`) is the only way to list individual bills today.

---

## Error Keys

| Key | HTTP | Thrown when |
|---|---|---|
| `supplier.NOT_FOUND` | 404 | Supplier id does not exist, or belongs to another shop |
| `supplier.PHONE_TAKEN` | 409 | Phone already used by an active supplier in this shop |
| `supplier.HAS_OPEN_DEBT` | 400 | Deactivating a supplier who is still owed money, or owes a refund |
| `supplier.PAID_EXCEEDS_TOTAL` | 400 | `paidAmount > totalAmount` when recording a bill |
| `supplier.INVOICE_TAKEN` | 409 | Same invoice number already used, live, for this supplier |
| `debt.NOT_CANCELLABLE_BY_ID` | 400 | Trying to cancel a receivable directly instead of through its order/receipt |
| `debt.ALREADY_CANCELLED` | 400 | Cancelling a bill that's already cancelled |
| `debt.NO_OPEN_SUPPLIER_DEBTS` | 404 | Paying a supplier who is owed nothing (see "Bugs found" below) |

All wired up in both languages: `i18n/{en,ar}/supplier.json` (new),
`i18n/{en,ar}/debt.json` (extended).

---

## Build Order

Eleven steps, each independently reviewable, each verified against real
data on the dev database before moving to the next — not a throwaway
database, the actual accumulated dev data, using temporary throwaway
accounts where real user passwords weren't available.

### Step 1 — Schema

`04-SupplierDebts.sql`. Verified all 21 pre-existing `debts` rows survived
the new constraint untouched, and the migration is a no-op on a second run.

### Step 2 — Entities

`Debt.creditor_shop_id` became `number | null`; added `creditor_type`,
`supplier_id`, `invoice_no`; new `Supplier` entity. Compiled clean —
**which was itself a finding**: comparing two nullable values with `===` is
legal TypeScript, so the compiler cannot catch the null-shop bug class
described above. The worklist for steps 3-4 had to come from manual review,
not from reading compiler errors.

### Steps 3-5 — The four leaks, `creditorType` threading, null-shop bugs

Covered in detail above. Verified: `GET /analytics/receivables` and
`GET /debts/summary` returned byte-identical numbers before and after —
unsurprising at this point since no payable existed yet, but it confirmed
the plumbing didn't regress anything that did exist.

### Step 6 — `createDebt`'s third recipe

`CreateDebtInput` gained a `kind: 'ORDER' | 'RECEIPT' | 'SUPPLIER_INVOICE'`
tag (replacing the old `debtorType`-based discrimination, which broke once
a payable also had `debtor_type: 'SHOP'`). Verified by actually shipping a
real order and making a real credit sale against live dev data — both
still worked exactly as before. One of the two orders used in testing had
to be redone: the first product picked had no order price configured, so
it correctly raised no debt at all (existing, intentional zero-price
behavior) rather than the bug it first looked like.

### Step 7 — Cancel by id

`cancelDebtById` + `POST /debts/:id/cancel`. Verified the *rejection* paths
against real receivables (a real order debt correctly refused with
`NOT_CANCELLABLE_BY_ID`) — the acceptance path couldn't be tested yet, since
no payable existed until step 9.

### Step 8 — Suppliers CRUD

`src/suppliers/` module, mirroring `src/customers/`. Verified create,
duplicate-phone rejection, list, get, update, cross-shop denial (404,
including from the admin — no bypass), employee denial (403), and
deactivate with correct active/inactive list filtering.

### Step 9 — Record and pay a bill

`POST /suppliers/:id/debts` wired the `SUPPLIER_INVOICE` recipe up to a
real route for the first time. This is where the feature became real:

- Created the first live supplier payable ever in the system — 150.00 /
  100.00 paid / 50.00 remaining, `PARTIAL`.
- Confirmed `GET /analytics/receivables` was unchanged with a real payable
  now sitting in the same table (`4241.76` / `2955.76`, before and after).
- Exercised the step 4 permission fix for real: the shop owner successfully
  reversed their own supplier payment (previously impossible before that
  fix).
- Cancelled the bill by id; a second cancel attempt was correctly refused.

**Bug found:** a duplicate invoice number leaked as a raw `500` instead of
a clean `409` — the pre-check pattern used for phone uniqueness
(`findActiveByPhone` before insert) had not been applied to invoice
uniqueness. Fixed with `SuppliersRepository.hasInvoice` + a pre-check in
`createDebt`, matching the existing convention exactly.

### Step 10 — FIFO across several bills

Generalized `findOpenByCustomerForUpdate` → `findOpenByPartyForUpdate` and
extracted `addPartyPayment` as described under Concurrency. Verified: two
bills (30.00 older, 40.00 newer), paid 50.00 with no target — the older
bill was fully settled first, the remainder went to the newer one, response
came back as an array of two allocations. Also verified the all-or-nothing
overpay rule and paying one specific bill by `debtId`.

**Bug found:** the "nothing is owed" error hardcoded the word "customer" —
paying a supplier who owed nothing said *"This customer does not owe
anything"*. Fixed with a distinct `NO_OPEN_SUPPLIER_DEBTS` key.

### Step 11 — Reports

`GET /analytics/payables` and `/aging`, plus `owed_to_suppliers` on the
shop summary. Needed almost no new logic — the generic `getSummary`/
`getAging` from steps 3-5 already accepted a `creditorType`. Verified an
open 80.00 bill showed up correctly in both the summary and the `0-30`
aging bucket, and that receivables numbers never moved throughout.

### Two bugs found, both the same shape

Both bugs found during this build (duplicate invoice → `500`, and the
"this customer" message) were caught only by actually exercising the
feature end to end against real data, not by reading the code. Neither was
a logic error in the core engine — both were missing polish at the edges
(an unhandled DB constraint, a hardcoded word in a shared error path) that
static review would plausibly have missed, since the code "looked" correct
in isolation.

---

## File Map

```
src/suppliers/                            NEW module
├── suppliers.module.ts                   imports DebtsModule
├── controllers/suppliers.controller.ts
├── services/suppliers.service.ts
├── repositories/suppliers.repository.ts
├── entities/supplier.entity.ts
└── dto/  create-supplier, update-supplier, supplier-query, create-supplier-debt

src/debts/
├── entities/debt.entity.ts               + CreditorType, ShopDebtsSummary.owed_to_suppliers
├── repositories/debts.repository.ts      + creditor_type filtering everywhere, cancelById,
│                                           getSummaryForSupplier, getSummaryForShopPayables,
│                                           findOpenByPartyForUpdate (replaces the customer-only version)
├── services/debts.service.ts             + cancelDebtById/cancelSupplierDebtForUser,
│                                           addSupplierPayment/addPartyPayment,
│                                           required creditorType on every read method
└── dto/  debt-query.dto.ts (+ supplierId), create-supplier-payment.dto.ts (new)

src/orders/services/orders.service.ts     kind: 'ORDER' instead of debtorType: 'SHOP'
src/receipts/services/receipts.service.ts kind: 'RECEIPT' instead of debtorType: 'CUSTOMER'

src/analytics/controllers/analytics.controller.ts   + GET payables, payables/aging

src/database/migrations/04-SupplierDebts.sql        NEW

i18n/{en,ar}/supplier.json                          NEW
i18n/{en,ar}/debt.json                              + NOT_CANCELLABLE_BY_ID, ALREADY_CANCELLED,
                                                       NO_OPEN_SUPPLIER_DEBTS
i18n/{en,ar}/fields.json                             + amount, totalAmount, paidAmount, invoiceNo,
                                                        supplierId, customerId, debtId, note
docs/testing/10-suppliers-testing.md                 NEW — Apidog/curl walkthrough
```

---

## Scope Decisions — Confirmed

### 1. No supplier list endpoint across all suppliers of a shop

`GET /suppliers/:id/debts` lists one supplier's bills. There is no
`GET /debts?creditorType=SUPPLIER`-equivalent "every payable across every
supplier" list — the client composes that view from `GET /suppliers`
(which already carries `total_remaining` per supplier) plus per-supplier
drill-down, the same shape `GET /customers` already uses for receivables.

**Why:** keeping a route from ever accepting a client-supplied
`creditorType` was a deliberate part of the leak fix — the ledger side must
come from the route, never from a query parameter, or the same class of
leak this feature spent five steps closing could be reopened by a single
new query param.

### 2. Refunds are report-only, same as receivables

A cancelled payable with `paid_amount > 0` means the supplier owes money
back. This is reported (`refund_due` on the payables summary) but not
processed — identical scope boundary to the existing receivables feature,
for the identical reason: it's a different money flow with its own rules,
and reporting it means the money is never hidden even though settling it
happens outside the app for now.

### 3. No due dates, no overdue alerts, no credit limits

Same as the receivables feature's `due_date` column: it exists (inherited
from the shared `debts` table) but nothing reads it yet.
