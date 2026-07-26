# Debts (Deferred Payment) — Implementation Plan

> **Status: PLAN ONLY.** Nothing here is built yet, except the schema migration
> `src/database/migrations/03-Debts.sql`, which is written and tested against a
> throwaway database. This document is for review before any service or
> controller code is written.

---

## Overview

The system tracks stock and sales, but it has no idea who **paid** and who
still **owes**. Today payment is handled on paper, outside the app.

This feature adds that missing half. A sale can now be closed with less money
than its total, and the difference is stored as a **debt** that can be
collected later, in parts.

There are two separate money relationships, and they share one engine:

| Flow | Source document | Who is owed (creditor) | Who owes (debtor) |
|---|---|---|---|
| **A. Warehouse → Shop** | an `order` | the warehouse | a `shop` (already exists) |
| **B. Shop → Customer** | a `receipt` | the shop | a `customer` (**new table**) |

The math, the ledger, the status rules, and the reports are identical for both.
Only the "who owes" side differs.

### Example (flow A)

1. Shop A orders goods worth **100**.
2. Warehouse admin ships the order.
3. Shop A pays **50** in cash. Admin records it.
4. A debt row stays open with `total_amount = 100`, `paid_amount = 50`,
   `remaining = 50`, `status = PARTIAL`.
5. Two weeks later Shop A pays the last 50. Status becomes `PAID`.

### Example (flow B)

A shop owner does **not** register every walk-in buyer. Only a customer who
takes goods without full payment is saved — name, phone, and their open debts.

---

## Decisions Already Made

These were agreed before writing this plan. They are settled, not open
questions.

| # | Question | Decision |
|---|---|---|
| 1 | Accrual or cash basis for revenue? | **Accrual.** Revenue is recognised when goods move, exactly as today. Existing profit queries are **not** modified. |
| 2 | When is an order debt created? | At **`SHIPPED`**. |
| 3 | One running balance per customer, or one debt per sale? | **One debt per sale.** You can see exactly which receipt is unpaid. |
| 4 | Can an EMPLOYEE sell on credit and collect money? | **Yes** — create and collect. Not reverse, not delete customers. |
| 5 | Due dates and overdue alerts? | **Later.** The `due_date` column exists but is unused in v1. |
| 6 | Currency | **SYP only.** Single currency, so no currency column. |
| 7 | Refund flow for cancelled part-paid debts? | **Report only in v1.** The amount to refund is shown; paying it back is not built. |
| 8 | Payment with no `debtId`? | **FIFO** — oldest open debt first. A specific debt is paid by sending `debtId`. |
| 9 | Can an EMPLOYEE reverse a payment or deactivate a customer? | **No.** Owner/admin only. |
| 10 | Can a SHOP_OWNER record their own payment to the warehouse? | **No.** Read-only. Only the admin records it. |

### Why accrual matters

This is the decision that keeps the feature small. Under accrual, **no existing
report changes**. Debts only *add* new numbers next to the old ones:

```
Revenue    = 1000   ← already works today, untouched
Collected  =  700   ← new
Receivable =  300   ← new
```

Under cash basis, every profit query in
`src/analytics/repositories/analytics.repository.ts` would have to be rewritten,
and reported profit would jump around based on when people happen to pay.

---

## Business Rules

### Creating a debt

- A debt is created **only** when the paid amount is less than the source total.
  Pay in full → no debt row at all.
- `total_amount` is a **snapshot** of the source total, taken once at creation.
  It is never recalculated. Repricing a product later cannot change what
  somebody already owes.
- Exactly **one live debt per source document** — enforced by a unique index, not
  only by service code.
- A free receipt (`is_free = TRUE`) can **never** have a debt. Nobody was
  charged, so nobody owes anything.
- A shop cannot owe itself (DB check).
- `total_amount` must be `> 0`.

### Collecting a payment

- `0 < amount <= remaining`. Overpayment is **rejected**, never turned into a
  credit balance. Reason: a negative debt would need its own refund rules, which
  do not exist in this system.
- Payments are **append-only**. A row is never updated and never deleted.
- A mistake is fixed by inserting a **reversal** row with a negative amount, so
  `SUM(debt_payments.amount)` always equals `debts.paid_amount` and the history
  stays readable ("collected 50, then reversed 20" — not "was always 30").
- A `CANCELLED` debt accepts no new payments.
- A `PAID` debt accepts no new payments (`remaining` is 0, so the range check
  already blocks it).

### Status

`status` is derived, never set by hand:

| Condition | Status |
|---|---|
| `paid_amount = 0` | `OPEN` |
| `0 < paid_amount < total_amount` | `PARTIAL` |
| `paid_amount = total_amount` | `PAID` |
| source was cancelled | `CANCELLED` |

Because a reversal lowers `paid_amount`, status moves **both ways**:
`PAID → PARTIAL → OPEN` is a normal, valid path.

---

## Interaction With Existing Features

This is the risky part of the feature — the places where debts touch code that
already works.

### Cancelling an order

`src/orders/services/orders.service.ts:177` allows cancel from
`PENDING`, `PROCESSING`, `SHIPPED`. The debt is created at `SHIPPED`. So an
order **can** be cancelled while a debt exists, possibly already part-paid.

**Rule:** cancelling the order sets its debt to `status = 'CANCELLED'` in the
**same transaction** as the stock restore. Payment rows are kept, not deleted.
A cancelled debt with `paid_amount > 0` means *money to give back* — it appears
in a "refund due" list rather than silently disappearing.

### Cancelling a receipt

`PATCH /receipts/:id/cancel` already restores stock and removes the sale from
analytics. Same rule: the debt is moved to `CANCELLED` inside the same
transaction.

### `PATCH /receipts/:id/free`

Marking a receipt free means the customer was never charged.

**Rule:** if the receipt has a debt with `paid_amount > 0`, **reject** the
request (`debt.HAS_PAYMENTS`). If `paid_amount = 0`, cancel the debt and allow
it. Otherwise money already collected would point at a sale that officially
charged nothing.

### Orders have no total column

`orders` stores no price. The total must be computed as
`SUM(order_items.quantity * order_items.price)` and snapshotted into
`debts.total_amount` **inside the same transaction** as the `SHIPPED` status
change.

### Revenue timing vs. debt timing

Warehouse revenue counts `COMPLETED` orders only
(`analytics.repository.ts:94`). The debt opens at `SHIPPED`. So between
`SHIPPED` and `COMPLETED` a receivable exists for an order that has not yet
been recognised as revenue.

This is **accepted, not a bug** — it is normal in real accounting. It is
documented here so nobody "fixes" it later by accident.

---

## Concurrency

Two people collecting from the same debt at the same moment must not both pass
the "not more than remaining" check.

**Pattern:** inside one transaction —

1. `SELECT ... FROM debts WHERE id = $1 FOR UPDATE` — the second request blocks
   here until the first commits.
2. Validate `0 < amount <= total_amount - paid_amount` against the **locked**
   row.
3. `INSERT INTO debt_payments (...)`.
4. `UPDATE debts SET paid_amount = paid_amount + $amount, status = <derived>`.
5. Write the audit log row.
6. Commit.

This differs from the conditional-`UPDATE` trick used by `cancel`/`setFree` in
receipts. Those flip a boolean, where "already done" is a valid answer. Here the
amount must be **read, checked, then written**, so a real row lock is needed.

`chk_debts_paid_not_over` is the backstop: even if the service logic were wrong,
Postgres refuses to store an overpaid row.

---

## Schema

Already written and tested: `src/database/migrations/03-Debts.sql`.

### `customers` (new)

Deliberately **not** a CRM. Only credit customers are stored, so a shop is never
forced to register walk-in cash buyers.

| Column | Notes |
|---|---|
| `shop_id` | owner shop, `ON DELETE CASCADE` |
| `name` | **not unique** — too many real people share a name |
| `phone` | unique per shop, scoped to `is_active = TRUE` |
| `is_active` | soft delete, so debt history is never lost |

### `debts` (new)

| Column | Notes |
|---|---|
| `creditor_shop_id` | who is owed |
| `debtor_type` | `SHOP` \| `CUSTOMER` |
| `debtor_shop_id` / `customer_id` | exactly one is set |
| `order_id` / `receipt_id` | exactly one is set — **real FKs** |
| `total_amount` | snapshot, `DECIMAL(15,2)` |
| `paid_amount` | denormalised running total |
| `status` | `OPEN` \| `PARTIAL` \| `PAID` \| `CANCELLED` |
| `due_date` | reserved for v2, unused now |

### `debt_payments` (new)

Append-only ledger. `is_reversal` + a sign check: collections are positive,
reversals negative. `reverses_payment_id` links a reversal to the collection it
undoes, with a unique index so a payment can be reversed at most once.

### `receipts.customer_id` (new column)

Nullable. The normal case is still an anonymous cash sale with no customer row.

### Constraints — tested behaviour

Verified with real inserts on a throwaway database:

| Test | Result |
|---|---|
| Valid shop debt | passes |
| Second debt for the same order | blocked — `idx_debts_order_unique` |
| `SHOP` debt pointing at a receipt | blocked — `chk_debts_debtor_shape` |
| Shop owes itself | blocked — `chk_debts_no_self_debt` |
| `paid_amount` 150 > `total_amount` 100 | blocked — `chk_debts_paid_not_over` |
| Reversal with a positive amount | blocked — `chk_debt_payments_sign` |
| Pay 50, reverse −20 → remaining 70, `PARTIAL` | correct |
| Cancel a debt, then re-open one for the same order | allowed |

> ⚠️ The local `inventory_db_dev` volume predates the migration squash, so
> `npm run migration:run` may fail there. Test on a fresh database.

### Two schema decisions worth reviewing

**Why real FKs (`order_id` / `receipt_id`) instead of a polymorphic
`(source_type, source_id)` pair?**
A polymorphic pair cannot be foreign-keyed, so a deleted order would leave a
debt pointing at a dead id, and every join needs a `CASE`. Two nullable FK
columns plus one `CHECK` give real referential integrity and simpler SQL. The
cost is one extra column — cheap.

**Why store `paid_amount` when `debt_payments` is the source of truth?**
The write path must lock the debt row anyway (see Concurrency). Once the row is
locked and in hand, keeping the running total on it makes the range check a
plain column read instead of a re-aggregation, and makes every list/summary
query avoid touching `debt_payments` entirely. The invariant
`paid_amount = SUM(debt_payments.amount)` is maintained inside the same
transaction that inserts the payment.

---

## Role Matrix

| Action | WAREHOUSE_ADMIN | SHOP_OWNER | EMPLOYEE |
|---|---|---|---|
| See shop debts (warehouse → shop) | All shops | Own shop, **read-only** | ✗ |
| Record a shop payment | ✓ | ✗ | ✗ |
| Create / edit a customer | ✗ | Own shop | Own shop |
| Delete (deactivate) a customer | ✗ | Own shop | ✗ |
| Sell on credit (receipt with debt) | ✗ | Own shop | Own shop |
| Record a customer payment | ✗ | Own shop | Own shop |
| **Reverse** a payment | ✓ (shop debts) | ✓ (own customer debts) | ✗ |
| Receivables reports | All | Own shop | Own shop |

Reasoning for the two employee restrictions: **reversing a payment** and
**deactivating a customer** are the only two actions that can hide collected
money. Everything else an employee needs for day-to-day selling is allowed.

---

## Endpoints

### Flow A — Warehouse ↔ Shop

| Method | Path | Roles |
|---|---|---|
| `POST` | `/orders/:id/payments` | ADMIN |
| `GET` | `/orders/:id/debt` | ADMIN, that shop's OWNER |
| `GET` | `/debts` | ADMIN (all), SHOP_OWNER (own), EMPLOYEE (customer debts only) |
| `GET` | `/debts/summary` | same scoping as `GET /debts` |
| `GET` | `/debts/:id` | ADMIN, that shop's OWNER |
| `GET` | `/debts/:id/payments` | ADMIN, that shop's OWNER |
| `POST` | `/debts/:id/payments/:paymentId/reverse` | ADMIN (order debts), OWNER (own customer debts) |
| `GET` | `/shops/:id/debts/summary` | ADMIN, that shop's OWNER |

The debt itself is **not** created by an endpoint. It appears automatically when
an order moves to `SHIPPED`.

### Flow B — Shop ↔ Customer

| Method | Path | Roles |
|---|---|---|
| `POST` | `/customers` | OWNER, EMPLOYEE |
| `GET` | `/customers` | OWNER, EMPLOYEE |
| `GET` | `/customers/:id` | OWNER, EMPLOYEE |
| `PATCH` | `/customers/:id` | OWNER, EMPLOYEE |
| `DELETE` | `/customers/:id` | OWNER (soft delete; blocked if a debt is open) |
| `GET` | `/customers/:id/debts` | OWNER, EMPLOYEE |
| `GET` | `/customers/:id/summary` | OWNER, EMPLOYEE |
| `POST` | `/customers/:id/payments` | OWNER, EMPLOYEE |

`POST /receipts` gains two optional fields. If `paidAmount < total`, the debt is
created in the **same transaction** as the receipt.

### Flow C — Reports

| Method | Path | Roles |
|---|---|---|
| `GET` | `/analytics/receivables` | ADMIN, OWNER, EMPLOYEE |
| `GET` | `/analytics/receivables/aging` | ADMIN, OWNER, EMPLOYEE |

Existing profit endpoints are **unchanged** (accrual).

---

## Request / Response Shapes

### POST /orders/:id/payments

```json
{ "amount": 50.00, "method": "CASH", "note": "paid at delivery" }
```

`201`:
```json
{
  "id": 12,
  "order_id": 7,
  "debtor_type": "SHOP",
  "debtor_shop_id": 2,
  "debtor_name": "Shop A",
  "total_amount": "100.00",
  "paid_amount": "50.00",
  "remaining": "50.00",
  "status": "PARTIAL",
  "created_at": "2026-07-26T09:00:00.000Z"
}
```

Money is returned as a **fixed-2-decimal string**, not a JS number, so
`0.1 + 0.2` can never surface as `0.30000000000000004`. (`analytics` casts to
`::float8` for charts — that is fine for a graph, not for a balance.)

### POST /customers/:id/payments

```json
{ "amount": 30.00, "debtId": 8, "method": "CASH" }
```

`debtId` is **optional**. If omitted, the amount is allocated **oldest debt
first (FIFO)**, and one `debt_payments` row is written per debt it touches, all
in one transaction. This matches how a shop actually works — a customer hands
over money for "what I owe", not for one specific receipt.

If the amount is larger than the customer's **total** remaining debt, the whole
request is rejected. No partial application, no credit balance.

### POST /receipts — added fields

| Field | Type | Required | Rules |
|---|---|---|---|
| `customerId` | number | No | Must belong to the caller's shop |
| `paidAmount` | number | No | Defaults to the full total (normal cash sale). `>= 0`, `<= total` |

Rules:
- `paidAmount < total` requires `customerId` — you cannot have an anonymous
  debt.
- `is_free = true` + `paidAmount < total` → rejected.

### GET /debts — query parameters

| Param | Values |
|---|---|
| `status` | `OPEN` \| `PARTIAL` \| `PAID` \| `CANCELLED` |
| `debtorType` | `SHOP` \| `CUSTOMER` |
| `shopId` | admin only |
| `customerId` | — |
| `from` / `to` | date range on `created_at` |
| `page` / `limit` | standard pagination (`paginate()` util) |

---

## DTOs (planned)

| DTO | File | Fields |
|---|---|---|
| `CreateDebtPaymentDto` | `src/debts/dto/create-debt-payment.dto.ts` | `amount` (number, `>0`, 2dp), `method?`, `note?` (max 500) |
| `CreateCustomerPaymentDto` | `src/debts/dto/create-customer-payment.dto.ts` | as above + `debtId?` |
| `ReverseDebtPaymentDto` | `src/debts/dto/reverse-debt-payment.dto.ts` | `reason?` (max 500) |
| `DebtQueryDto` | `src/debts/dto/debt-query.dto.ts` | filters above |
| `CreateCustomerDto` | `src/customers/dto/create-customer.dto.ts` | `name` (required), `phone?`, `note?` |
| `UpdateCustomerDto` | `src/customers/dto/update-customer.dto.ts` | partial of the above |
| `CustomerQueryDto` | `src/customers/dto/customer-query.dto.ts` | `search?`, `hasDebt?`, pagination |

> ⚠️ **Known trap:** optional numeric query params with `ParseIntPipe` currently
> throw when the param is omitted, instead of being skipped (see the existing
> product-create bug). `DebtQueryDto` and `CustomerQueryDto` must not repeat it.

---

## Audit Log Integration

Money movement must be traceable. Every payment and reversal writes one
`audit_logs` row **inside the same transaction**.

| Field | Value |
|---|---|
| `type` | `DEBT` |
| `action` | `PAYMENT` / `REVERSAL` / `CANCELLED` |
| `entity_type` | `debt` |
| `entity_id` | the `debts.id` |
| `amount` | the payment amount (negative for a reversal) |
| `notes` | the `note` / `reason` from the request |
| `shop_id` | the creditor shop |
| `user_id` | who did it |

---

## Analytics Impact

**No existing query is modified.** Two new ones are added:

### `GET /analytics/receivables`

```
total_billed     = SUM(total_amount)  WHERE status <> 'CANCELLED'
total_collected  = SUM(paid_amount)   WHERE status <> 'CANCELLED'
total_receivable = total_billed - total_collected
open_count       = COUNT(*) WHERE status IN ('OPEN','PARTIAL')
refund_due       = SUM(paid_amount)   WHERE status = 'CANCELLED' AND paid_amount > 0
```

### `GET /analytics/receivables/aging`

Buckets by **`created_at`** (not `due_date`, which is unused in v1):

| Bucket | Meaning |
|---|---|
| `0–30` | recent, normal |
| `31–60` | getting late |
| `60+` | needs chasing |

This is the report that makes the feature actually useful day to day.

---

## Error Keys

| Key | HTTP | Thrown when |
|---|---|---|
| `debt.NOT_FOUND` | 404 | Debt id does not exist |
| `debt.ACCESS_DENIED` | 403 | Debt belongs to another shop |
| `debt.ALREADY_PAID` | 400 | Debt is fully paid |
| `debt.CANCELLED` | 400 | Payment attempted on a cancelled debt |
| `debt.AMOUNT_EXCEEDS_REMAINING` | 400 | `amount > remaining` |
| `debt.AMOUNT_INVALID` | 400 | `amount <= 0` |
| `debt.HAS_PAYMENTS` | 400 | Marking a receipt free while its debt has collected money |
| `debt.ALREADY_REVERSED` | 400 | Reversing the same payment twice |
| `debt.NOT_REVERSIBLE` | 400 | Reversing a reversal row — record a new payment instead |
| `debt.PAYMENT_NOT_FOUND` | 404 | Payment id does not belong to this debt |
| `customer.NOT_FOUND` | 404 | Customer id does not exist |
| `customer.ACCESS_DENIED` | 403 | Customer belongs to another shop |
| `customer.PHONE_TAKEN` | 409 | Phone already used in this shop |
| `customer.HAS_OPEN_DEBT` | 400 | Deactivating a customer who still owes money |
| `receipt.CUSTOMER_REQUIRED` | 400 | `paidAmount < total` without a `customerId` |
| `receipt.FREE_CANNOT_HAVE_DEBT` | 400 | `is_free` + partial payment |

`debt.*` keys are wired up in `i18n/en/debt.json` and `i18n/ar/debt.json`.
`customer.*` and the two new `receipt.*` keys arrive with steps 3–4. See
`docs/features/10-i18n-localization.md`.

---

## Build Order

Each step is independently reviewable and leaves the app working.

### Step 1 — Schema ✅ done

`src/database/migrations/03-Debts.sql`, applied and constraint-tested on a
throwaway database. Not yet run on any real database.

### Step 2 — Core debts module (no HTTP) ✅ done

The shared engine both flows use. No controller, no `RequestUser` — permission
and ownership checks belong to the callers that own the source document.

```
src/debts/
├── debts.module.ts                       exports DebtsService
├── entities/       debt.entity.ts, debt-payment.entity.ts
├── repositories/   debts.repository.ts   (findByIdForUpdate, insert, insertPayment,
│                                          applyPaymentDelta, cancelBySource)
└── services/       debts.service.ts      (createDebt, addPayment, reversePayment,
                                           cancelDebt, getBalance, toBalance)

src/common/utils/money.util.ts            NEW — bigint minor-unit helpers
i18n/{en,ar}/debt.json                    NEW — the debt.* keys above
```

Every service method takes an **optional** transaction `client`. Passing one
composes the work into the caller's transaction — required for `createDebt` and
`cancelDebt`, since a debt must appear and disappear atomically with the
order/receipt that raised it. Omitting it opens a transaction internally, which
is what the standalone payment endpoints will do.

**Money never becomes a float.** `pg` returns DECIMAL as a string and it stays a
string; additions happen in Postgres `numeric`
(`applyPaymentDelta`), and the service-side comparisons go through bigint minor
units in `money.util.ts`. Number is not safe here — DECIMAL(15,2) reaches ~1e17
minor units, past `Number.MAX_SAFE_INTEGER`.

**Status is derived in exactly one place** — the `CASE` inside
`applyPaymentDelta` — so it can never disagree with `paid_amount`. Because a
reversal lowers `paid_amount`, `PAID → PARTIAL → OPEN` happens naturally.

#### Schema change made during this step

`debt_payments` gained `reverses_payment_id` (self-referencing FK) plus a unique
partial index on it. Without a link column there is no way to answer "was this
payment already reversed?", which `debt.ALREADY_REVERSED` needs. `03-Debts.sql`
was amended rather than superseded by an `04-` file, since it had not been run
on any real database yet.

#### Verified against a real database

33 checks on a throwaway database exercising `DebtsService` directly:

| Area | Covered |
|---|---|
| Happy path | 100 debt → pay 50 → `PARTIAL` → pay 50 → `PAID`, remaining exact at each step |
| Overpay | 60 against 50 remaining → `AMOUNT_EXCEEDS_REMAINING`; paying a settled debt → `ALREADY_PAID` |
| Reversal | ledger stays append-only (3 rows, `50 / 50 / −50`), reversal links its target, double reverse → `ALREADY_REVERSED`, reversing a reversal → `NOT_REVERSIBLE` |
| Cancel | payments kept as refund-due, paying a cancelled debt → `CANCELLED`, cancelling twice → `null`, cancelling a source with no debt → `null` |
| Validation | zero / negative / malformed amounts → `AMOUNT_INVALID`, missing debt → `NOT_FOUND` |
| Float safety | `0.10 + 0.20` settles a `0.30` debt to `PAID` with remaining exactly `0.00` |
| **Concurrency** | two parallel `60.00` collections against a `100.00` debt — exactly one wins, `paid_amount` stays `60.00` |
| Audit | 8 `DEBT` rows in the expected order, reversal logged negative |
| Invariant | `SUM(debt_payments.amount) = debts.paid_amount` for every debt |

Not yet covered: `createDebt` writes no audit row (the order/receipt transition
that raises it is logged by its own module). Add a `DEBT / CREATED` entry in
step 3 if the audit trail feels thin in practice.

### Step 3 — Warehouse ↔ Shop ✅ done

```
src/debts/
├── controllers/debts.controller.ts       /debts list, summary, detail, payments, reverse
├── dto/  create-debt-payment, reverse-debt-payment, debt-query
├── repositories/debts.repository.ts      + findPaginated, getSummary,
│                                           getSummaryForShopAs, buildFilters
└── services/debts.service.ts             + access-checked wrappers (see below)

src/orders/
├── services/orders.service.ts            + raiseOrderDebt on SHIPPED,
│                                           cancelDebt on CANCELLED
├── repositories/orders.repository.ts     + sumTotalPrice (DECIMAL string)
├── controllers/orders.controller.ts      + GET :id/debt, POST :id/payments
└── orders.module.ts                      imports DebtsModule

src/shops/
├── controllers/shops.controller.ts       + GET :id/debts/summary
└── shops.module.ts                       imports DebtsModule
```

**Where permission lives.** The engine methods from step 2 still take no
`RequestUser`. The `/debts` routes are the debts module's own surface, so
access-checked wrappers (`findAll`, `findByIdForUser`, `addOrderPayment`,
`reversePaymentForUser`, `getShopSummary`) sit alongside them in the same
service, clearly separated. Visibility is resolved from the role *before* the
query runs and ANDed on top of the user's filters, so a `?shopId=` cannot widen
what someone can see.

**`GET /debts/summary` is declared before `GET /debts/:id`** — otherwise the
param route swallows the literal path.

**Order total.** `sumTotalPrice` returns `::text`, not the `::float8` the
order list/detail queries use for display. That value is snapshotted into
`debts.total_amount`, so it must never pass through a float.

**Zero-priced orders raise no debt.** Samples and promotional stock total
`0.00`; creating an already-settled debt row would be noise.

#### Verified end to end over HTTP

53 checks against a running app on a throwaway database — real JWTs for admin,
shop owner, employee, and an unrelated shop owner:

| Area | Covered |
|---|---|
| Debt timing | absent at PENDING and PROCESSING, appears at SHIPPED with the total snapshotted from `order_items` |
| Collection | 50 → `PARTIAL`, then 10 → remaining `40.00`; both `"50.00"` and `50` accepted as input |
| Rejected input | overpay, 3 decimals, negative, zero, unknown method, order with no debt |
| Permissions | shop owner and employee cannot record a payment; owner reads own debt; other shop 403; employee 403 on a SHOP debt; owner cannot reverse an order payment |
| List scoping | admin 1, owner 1, employee 0, unrelated shop 0; `?shopId=` cannot widen scope; bad status 400 |
| Reversal | ledger append-only (`50 / 10 / −50`), links its target, double reverse blocked, reversing a reversal blocked |
| Summaries | both ledger sides; owner blocked on another shop; employee has no summary route |
| Cancel a part-paid shipped order | debt → `CANCELLED`, drops out of receivables, `refund_due` `10.00`, stock restored, no further reversal |
| Invariants | `SUM(debt_payments.amount) = debts.paid_amount`; audit rows written |

#### Bug found and fixed during this step

`COALESCE(SUM(...), 0)::text` serialized an empty result set as `"0"` but a
populated one as `"0.00"` — the integer literal fallback has no scale. Money
must render identically either way, so the summary casts
`::numeric(15,2)::text`. A shop with no debts would otherwise have returned a
differently-shaped amount than a shop with debts.

### Step 4 — Shop ↔ Customer

- New `customers` module (full CRUD + search).
- Add `customerId` / `paidAmount` to `CreateReceiptDto`, wire the debt into the
  receipt transaction.
- Hook `cancelDebt` into receipt cancel; guard `setFree`.
- `POST /customers/:id/payments` with FIFO allocation.

### Step 5 — Reports

- `getReceivablesSummary`, `getReceivablesAging` in `AnalyticsRepository`.
- Two new controller routes.

### Step 6 — Later (not v1)

Due dates, overdue notifications, credit limit per customer, printable customer
statement, partial refunds on cancelled part-paid debts.

---

## File Map (planned)

```
src/debts/                                NEW module
├── debts.module.ts
├── controllers/debts.controller.ts
├── services/debts.service.ts
├── repositories/debts.repository.ts
├── entities/debt.entity.ts, debt-payment.entity.ts
└── dto/  create-debt-payment, create-customer-payment,
          reverse-debt-payment, debt-query

src/customers/                            NEW module
├── customers.module.ts
├── controllers/customers.controller.ts
├── services/customers.service.ts
├── repositories/customers.repository.ts
├── entities/customer.entity.ts
└── dto/  create-customer, update-customer, customer-query

src/orders/
├── services/orders.service.ts            + create debt on SHIPPED,
│                                           cancel debt on CANCELLED
└── controllers/orders.controller.ts      + POST /orders/:id/payments

src/receipts/
├── services/receipts.service.ts          + debt on partial payment,
│                                           cancel debt on cancel,
│                                           guard setFree
├── entities/receipt.entity.ts            + customer_id
└── dto/create-receipt.dto.ts             + customerId?, paidAmount?

src/analytics/
├── repositories/analytics.repository.ts  + receivables summary + aging
│                                           (existing queries untouched)
└── controllers/analytics.controller.ts   + 2 routes

src/database/migrations/
└── 03-Debts.sql                          ✅ written + tested

i18n/en/*.json, i18n/ar/*.json            + debt.*, customer.*, receipt.* keys
```

---

## Scope Decisions — Confirmed

These were reviewed and confirmed. They are closed, not open questions. The
reasoning is recorded here so a later reader does not reopen them by accident.

### 1. Refunds are report-only in v1

A cancelled debt with `paid_amount > 0` means money must go back. v1 **reports**
that amount (`refund_due` in the receivables summary) but does **not** process
the refund.

**Why:** the first version is about *receivables* — money coming in. Refund
processing is a different money flow with its own rules (who approves it, cash
or credit note, what happens to the audit trail) and would double the scope.
Reporting it means the money is never lost or hidden; someone just settles it
outside the app, the same way payment worked before this feature.

### 2. Payment allocation is FIFO

`POST /customers/:id/payments` **without** `debtId` applies the amount to the
oldest open debts first, writing one `debt_payments` row per debt it touches.
Sending `debtId` targets one specific debt instead.

**Why:** it matches reality. A customer hands over money for "what I owe", not
for one particular receipt. Oldest-first also clears the riskiest debt first.
The explicit `debtId` escape hatch covers the case where the customer really is
settling one known sale.

### 3. Reversal and customer deactivation are owner/admin only

An EMPLOYEE **can** create credit sales and collect payments. An EMPLOYEE
**cannot** reverse a payment or deactivate a customer.

**Why:** those are the only two actions that change financial records after the
fact — a reversal makes collected money disappear, and deactivating a customer
hides a debtor. Everything an employee needs to sell and collect day-to-day
stays allowed, so the restriction costs nothing operationally.

### 4. Shop owners have read-only access to their warehouse debt

A SHOP_OWNER can see what their shop owes the warehouse. Only a WAREHOUSE_ADMIN
can record a payment against it.

**Why:** the admin is the one who physically receives and verifies the money.
If a shop could record its own payments, it could mark itself as paid without
any money changing hands. Recording follows the cash, not the debt.

> Note: this applies **only** to flow A (warehouse → shop). In flow B the shop
> owner *is* the one receiving the money, so they record customer payments
> themselves.
