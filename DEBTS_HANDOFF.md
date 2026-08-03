# Debts (Deferred Payment) — Frontend Handoff

> **Status:** Backend complete (v1) and ready for integration.
> **Base URL (dev):** `http://localhost:3001`
> **API Docs (Swagger):** `http://localhost:3001/api`
>
> This is a supplement to `FRONTEND_HANDOFF.md` — read that first for auth,
> response envelope, and pagination. This file covers only what's new.

---

## Table of Contents

1. [What This Feature Does](#1-what-this-feature-does)
2. [Roles & Permissions](#2-roles--permissions)
3. [Endpoints — Warehouse ↔ Shop](#3-endpoints--warehouse--shop)
4. [Endpoints — Shop ↔ Customer](#4-endpoints--shop--customer)
5. [Endpoints — Debts (shared)](#5-endpoints--debts-shared)
6. [Endpoints — Reports](#6-endpoints--reports)
7. [Changes to Existing Endpoints](#7-changes-to-existing-endpoints)
8. [Domain Concepts & Enums](#8-domain-concepts--enums)
9. [Rules the Frontend Must Respect](#9-rules-the-frontend-must-respect)
10. [Error Keys](#10-error-keys)
11. [UI Flows & Suggested Pages](#11-ui-flows--suggested-pages)
12. [Worked Example (end to end)](#12-worked-example-end-to-end)

---

## 1. What This Feature Does

Before this feature, every sale had to be paid in full, in cash, on the spot.
Now a sale can be closed with **less** money than its total, and the
difference is tracked as a **debt** that gets collected later, in parts.

There are two independent flows that share the same engine:

| Flow | Happens when | Debtor | Creditor |
|------|--------------|--------|----------|
| **Warehouse → Shop** | An **order** ships before it's fully paid | The shop | The warehouse |
| **Shop → Customer** | A **receipt** (sale) is made on credit | A customer | The shop |

**Revenue reporting is unchanged.** `profit-summary` / `profit-trend` still
count revenue the moment goods move (order `COMPLETED`, or a receipt being
made) — not when money arrives. Debts are a separate, additional set of
numbers: how much is still owed, and for how long it's been owed. Don't try to
net them against the profit numbers — they answer different questions.

A debt is created **automatically** — there's no "create debt" button:
- An order's debt appears the moment it's marked `SHIPPED`, if it wasn't
  already fully paid.
- A receipt's debt appears at the moment of sale, if `paidAmount` sent is less
  than the total.

---

## 2. Roles & Permissions

| Action | WAREHOUSE_ADMIN | SHOP_OWNER | EMPLOYEE |
|---|:---:|:---:|:---:|
| View a shop's order-debt | ✅ any shop | ✅ own shop only | ❌ |
| Record a payment on an order-debt | ✅ | ❌ | ❌ |
| Manage customers (create/edit) | ❌ | ✅ own shop | ✅ own shop |
| Sell on credit / collect from a customer | ❌ | ✅ | ✅ |
| Deactivate a customer | ❌ | ✅ | ❌ |
| Reverse *any* payment | ✅ order-debts only | ✅ own customer-debts only | ❌ |
| View receivables report / aging | ✅ all | ✅ own shop | ✅ (customer debts only) |

Two things worth designing the UI around:

- **`WAREHOUSE_ADMIN` has zero access to `/customers`.** A shop's customers
  are its own business. Don't show a customers tab in the admin dashboard.
- **A shop owner cannot pay their own order-debt** — only the admin can,
  because the admin is the one who physically receives the money. If you're
  building the shop-owner dashboard, show the order-debt as **read-only**
  ("You owe 25.00 to the warehouse") with no "pay" button.

---

## 3. Endpoints — Warehouse ↔ Shop

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/orders/:id/debt` | ADMIN, owning SHOP_OWNER | The order's debt. `404` if paid in full or not shipped yet |
| POST | `/orders/:id/payments` | ADMIN | Record money received for this order |

**Get order debt** `GET /orders/:id/debt`

```json
{
  "id": 12,
  "creditor_shop_id": 1,
  "debtor_type": "SHOP",
  "debtor_shop_id": 2,
  "customer_id": null,
  "order_id": 7,
  "receipt_id": null,
  "total_amount": "100.00",
  "paid_amount": "50.00",
  "status": "PARTIAL",
  "due_date": null,
  "note": "Order #7",
  "created_by": 1,
  "created_at": "2026-07-26T09:00:00.000Z",
  "updated_at": "2026-07-26T09:10:00.000Z",
  "remaining": "50.00"
}
```

> Returns `404` with key `debt.NOT_FOUND` if the order hasn't shipped yet, or
> was paid in full. Don't treat 404 here as an error state in the UI — it just
> means "nothing owed".

**Record a payment** `POST /orders/:id/payments`

```json
{ "amount": "50.00", "method": "CASH", "note": "Paid at delivery" }
```

- `amount` is a **string**, `> 0`, at most 2 decimal places. `method` is
  optional (`CASH` default). `note` is optional, max 500 chars.
- Returns the updated debt object (same shape as above, without `remaining`
  wrapped — use `total_amount - paid_amount` or call `GET .../debt` again).
- `400 debt.AMOUNT_EXCEEDS_REMAINING` if `amount` is more than what's left.
  Response includes `remaining` in the message args so you can show "only
  25.00 left" without a second request.

---

## 4. Endpoints — Shop ↔ Customer

### Customers

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/customers` | OWNER, EMPLOYEE | Register a credit customer |
| GET | `/customers` | OWNER, EMPLOYEE | List, paginated |
| GET | `/customers/:id` | OWNER, EMPLOYEE | Get one |
| PATCH | `/customers/:id` | OWNER, EMPLOYEE | Update |
| DELETE | `/customers/:id` | OWNER only | Deactivate (soft delete) |
| GET | `/customers/:id/debts` | OWNER, EMPLOYEE | This customer's debts |
| GET | `/customers/:id/summary` | OWNER, EMPLOYEE | Totals for this customer |
| POST | `/customers/:id/payments` | OWNER, EMPLOYEE | Collect a payment |

**Create** `POST /customers`
```json
{ "name": "Ali Hassan", "phone": "0999123456", "note": "Buys weekly" }
```
`name` is required. `phone` is optional but **unique per shop** — `409
customer.PHONE_TAKEN` on collision. `phone` is *not* required, but without it
you can't tell two "Ali"s apart, so the UI should nudge for it.

**List** `GET /customers?search=ali&hasDebt=true&includeInactive=false&page=1&limit=10`

| Param | Type | Description |
|---|---|---|
| `search` | string | Matches name or phone |
| `hasDebt` | boolean | Only customers who still owe money |
| `includeInactive` | boolean | Include deactivated customers (default: hidden) |

Each row carries its balance directly — no need to sum debts client-side:
```json
{
  "id": 7, "shop_id": 2, "name": "Ali Hassan", "phone": "0999123456",
  "note": null, "is_active": true,
  "created_at": "...", "updated_at": "...",
  "open_debts_count": 2,
  "total_remaining": "25.00"
}
```

**Deactivate** `DELETE /customers/:id`
- `400 customer.HAS_OPEN_DEBT` if they still owe money, **or** if a sale to
  them was cancelled while they'd already paid (the shop owes *them* a
  refund). Either way, show: *"Cannot remove — settle the balance first."*

**Collect a payment** `POST /customers/:id/payments`
```json
{ "amount": "40.00" }
```
or, to pay one specific sale instead of the oldest-first default:
```json
{ "amount": "40.00", "debtId": 12 }
```

- Without `debtId`, the amount is applied to the customer's **oldest debts
  first (FIFO)** and can settle more than one sale in a single call.
- Response is an **array** — one entry per debt it touched:
```json
[
  { "debt_id": 8,  "receipt_id": 21, "amount": "20.00", "status": "PAID",    "remaining": "0.00" },
  { "debt_id": 9,  "receipt_id": 24, "amount": "20.00", "status": "PARTIAL", "remaining": "5.00" }
]
```
- `404 debt.NO_OPEN_DEBTS` if the customer owes nothing at all.
- `400 debt.AMOUNT_EXCEEDS_REMAINING` if `amount` is more than everything they
  owe combined — **nothing is applied**, it's all-or-nothing per request.

---

## 5. Endpoints — Debts (shared)

Read/manage endpoints that work for **both** flows — the same debt object
whether it came from an order or a receipt.

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/debts` | ADMIN, OWNER, EMPLOYEE | List, scoped by role |
| GET | `/debts/summary` | ADMIN, OWNER, EMPLOYEE | Totals for what you can see |
| GET | `/debts/:id` | ADMIN, OWNER, EMPLOYEE | One debt + balance |
| GET | `/debts/:id/payments` | ADMIN, OWNER, EMPLOYEE | Payment history |
| POST | `/debts/:id/payments/:paymentId/reverse` | ADMIN, OWNER | Undo a payment |

**List** `GET /debts?status=OPEN&debtorType=SHOP&shopId=2&customerId=7&agingBucket=60%2B&fromDate=2026-06-01&toDate=2026-06-30&page=1&limit=10`

All filters optional and combinable.

| Param | Values |
|---|---|
| `status` | `OPEN` \| `PARTIAL` \| `PAID` \| `CANCELLED` |
| `debtorType` | `SHOP` \| `CUSTOMER` |
| `shopId` | admin only — filter by debtor shop |
| `customerId` | filter by customer |
| `agingBucket` | `0-30` \| `31-60` \| `60+` — ⚠️ URL-encode `+` as `%2B`. Implies "still owed", so combining it with `status=PAID` returns nothing |
| `fromDate` / `toDate` | date range on when the debt was created |

Visibility is enforced server-side regardless of what you send:
- `WAREHOUSE_ADMIN` sees everything.
- `SHOP_OWNER` only sees debts their shop is a party to (either side).
- `EMPLOYEE` only sees `CUSTOMER` debts (never their shop's own debt to the
  warehouse) — so `?debtorType=SHOP` as an employee just returns an empty list,
  not an error.

Each row:
```json
{
  "id": 8, "creditor_shop_id": 2, "debtor_type": "CUSTOMER",
  "debtor_shop_id": null, "customer_id": 7, "order_id": null, "receipt_id": 21,
  "total_amount": "30.00", "paid_amount": "10.00", "status": "PARTIAL",
  "due_date": null, "note": "Receipt #21",
  "created_by": 3, "created_at": "...", "updated_at": "...",
  "remaining": "20.00",
  "debtor_name": "Ali Hassan",
  "creditor_shop_name": "Downtown Shop"
}
```
`debtor_name` resolves to the shop name or the customer name automatically —
render one column, don't branch on `debtor_type` in the UI.

**Reverse a payment** `POST /debts/:id/payments/:paymentId/reverse`
```json
{ "reason": "Entered twice by mistake" }
```
- Appends a **negative** row to the ledger rather than deleting the original —
  `GET /debts/:id/payments` will show both the original and the reversal.
- `400 debt.ALREADY_REVERSED` if that payment was already undone.
- `400 debt.NOT_REVERSIBLE` if you try to reverse a reversal — the message
  tells the user to record a new payment instead.
- **Permission depends on which side of the debt it is**: admin for
  order-debts, the owning shop owner for customer-debts. An employee gets
  `403` either way — don't show a "reverse" button for employees at all.

---

## 6. Endpoints — Reports

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/shops/:id/debts/summary` | ADMIN, owning OWNER | Both sides of one shop's ledger |
| GET | `/analytics/receivables` | ADMIN, OWNER, EMPLOYEE | Totals across what the caller can see |
| GET | `/analytics/receivables/aging` | ADMIN, OWNER, EMPLOYEE | Owed money grouped by age |

**Shop's two-sided summary** `GET /shops/:id/debts/summary`

A shop both owes the warehouse *and* is owed by its own customers — these are
reported **separately**, never netted:
```json
{
  "shop_id": 2,
  "owed_by_shop": { "total_billed": "100.00", "total_collected": "50.00", "total_remaining": "50.00", "open_count": 1, "refund_due": "0.00" },
  "owed_to_shop":  { "total_billed": "30.00",  "total_collected": "10.00", "total_remaining": "20.00", "open_count": 1, "refund_due": "0.00" }
}
```

**Receivables summary** `GET /analytics/receivables` — same filters as
`GET /debts` (`status`, `debtorType`, `shopId`, `customerId`, date range).
Same shape as one `DebtsSummary` block above. No `?period=` — this is a
balance *right now*, not a chart over time.

`refund_due` is money that was collected on a debt whose sale was later
**cancelled** — the shop/warehouse now owes it back. v1 only reports this
number; there's no "process refund" endpoint yet, so surface it as a flagged
line item, not a button.

**Aging report** `GET /analytics/receivables/aging`
```json
[
  { "bucket": "0-30",  "count": 3, "amount": "45.00" },
  { "bucket": "31-60", "count": 1, "amount": "20.00" },
  { "bucket": "60+",   "count": 2, "amount": "80.00" }
]
```
- **Always exactly 3 rows**, even at `count: 0` — safe to map directly onto a
  3-bar chart without a "no data" branch.
- `amount` is the **remaining** balance in that bucket, not the original sale
  value.
- Click-through: `GET /debts?agingBucket=60%2B` returns exactly the debts
  behind that bar — same count, same total.

---

## 7. Changes to Existing Endpoints

### `POST /receipts` — two new optional fields

```json
{
  "items": [{ "inventoryId": 3, "quantity": 3 }],
  "customerId": 7,
  "paidAmount": "10.00"
}
```

| Field | Required? | Behavior |
|---|---|---|
| `customerId` | Only if `paidAmount` < total | Which customer owes the rest |
| `paidAmount` | No — defaults to the full total | `0` = fully on credit. Must be `<=` the receipt total |

- Omit both fields entirely → behaves exactly like before (normal, fully-paid,
  anonymous sale).
- `paidAmount` less than the total **without** `customerId` → `400
  receipt.CUSTOMER_REQUIRED`.
- `paidAmount` greater than the total → `400 receipt.PAID_EXCEEDS_TOTAL`.

**The receipt response now carries its own debt**, so a credit sale needs no
second request:
```json
{
  "id": 21, "shop_id": 2, "created_by": 3, "notes": null,
  "is_free": false, "is_cancelled": false,
  "customer_id": 7, "customer_name": "Ali Hassan",
  "total_price": 30, "items": [ ... ],
  "debt": {
    "id": 8, "total_amount": "30.00", "paid_amount": "10.00",
    "remaining": "20.00", "status": "PARTIAL"
  }
}
```
`debt` is `null` on a normal cash sale. Check it to decide whether to show a
"remaining: 20.00" badge on the receipt.

### `PATCH /receipts/:id/free`

If the receipt already had money collected against it (a credit sale that was
partially paid), you now get `400 debt.HAS_PAYMENTS` — you can't mark a sale
"free" after taking payment for it. If nothing was ever collected, marking it
free now also cancels the debt automatically (no separate step needed).

### `PATCH /receipts/:id/cancel`

If the receipt had a debt, cancelling the receipt cancels the debt too, in the
same request. Any money already collected on it becomes `refund_due` — it does
**not** disappear.

---

## 8. Domain Concepts & Enums

### DebtorType
```
SHOP       — a shop owes the warehouse (from an order)
CUSTOMER   — a customer owes a shop (from a receipt)
```

### DebtStatus
```
OPEN      → PARTIAL → PAID
                          ↘
                        CANCELLED (from any non-PAID state, or even PAID —
                                    see refund_due)
```
Status is always **derived** from `paid_amount` vs `total_amount` — never set
directly. Note it can move backwards: reversing a payment can take a debt from
`PAID` back to `PARTIAL`, or `PARTIAL` back to `OPEN`.

### PaymentMethod
```
CASH
TRANSFER
OTHER
```

### AgingBucket
```
0-30    — recent, normal
31-60   — getting late
60+     — needs chasing
```
Measured from `created_at`. (`due_date` exists on the debt object for a future
version but nothing sets it yet — ignore it for now.)

---

## 9. Rules the Frontend Must Respect

**All money fields are strings, always** — `"50.00"`, never `50`. This
includes every `amount`, `total_amount`, `paid_amount`, `remaining`,
`total_billed`, etc. across this entire feature. Do not `JSON.parse` them into
a JS number for arithmetic — floating point will eventually produce
`0.30000000000000004` and a customer balance will be wrong by a fraction of a
unit. If you need to display a sum client-side, use a decimal library
(`decimal.js`, `big.js`) — never native `+`.

When **sending** an amount, a JSON number like `50` is accepted and converted
server-side, but anything with more than 2 decimal places (`10.999`) is
rejected with `400` — validate to 2dp in the input mask before submitting.

**A debt is never created directly.** There's no `POST /debts`. It only ever
appears as a side effect of shipping an order or making a partial-payment
receipt. Don't build a "create debt" form.

**FIFO payments can touch several debts in one call** — always render
`POST /customers/:id/payments`'s array response as a list of "what this
payment settled", not a single confirmation toast.

**`refund_due` has no action button yet.** Surface it as information
("₤15.00 owed back to this customer") — there's no endpoint to process it in
v1.

---

## 10. Error Keys

All errors follow the existing `{ success:false, statusCode, message, error,
timestamp }` shape from `FRONTEND_HANDOFF.md` §7. New keys introduced by this
feature (`message` is already translated server-side based on
`Accept-Language`):

| Key | HTTP | When |
|---|---|---|
| `debt.NOT_FOUND` | 404 | No such debt (or nothing owed on this order) |
| `debt.ACCESS_DENIED` | 403 | Debt doesn't belong to you |
| `debt.ALREADY_PAID` | 400 | Trying to pay a settled debt |
| `debt.CANCELLED` | 400 | Trying to pay a cancelled debt |
| `debt.AMOUNT_EXCEEDS_REMAINING` | 400 | Amount > what's left |
| `debt.AMOUNT_INVALID` | 400 | Not a positive number, or too many decimals |
| `debt.HAS_PAYMENTS` | 400 | Marking a paid-against receipt as free |
| `debt.ALREADY_REVERSED` | 400 | That payment was already undone |
| `debt.NOT_REVERSIBLE` | 400 | Trying to reverse a reversal |
| `debt.PAYMENT_NOT_FOUND` | 404 | Payment id doesn't belong to this debt |
| `debt.NO_OPEN_DEBTS` | 404 | Customer owes nothing |
| `customer.NOT_FOUND` | 404 | No such customer (or it's another shop's) |
| `customer.PHONE_TAKEN` | 409 | Phone already used by another active customer in this shop |
| `customer.HAS_OPEN_DEBT` | 400 | Can't deactivate — money still owed either direction |
| `receipt.CUSTOMER_REQUIRED` | 400 | Partial payment sent with no `customerId` |
| `receipt.PAID_EXCEEDS_TOTAL` | 400 | `paidAmount` > receipt total |

---

## 11. UI Flows & Suggested Pages

### Warehouse Admin
| Page | Key APIs |
|---|---|
| Shop debt list | `GET /debts?debtorType=SHOP` |
| Order debt detail | `GET /orders/:id/debt`, `POST /orders/:id/payments` |
| Receivables dashboard | `GET /analytics/receivables`, `GET /analytics/receivables/aging` |
| Reverse a shop payment | `GET /debts/:id/payments`, `POST /debts/:id/payments/:paymentId/reverse` |

### Shop Owner
| Page | Key APIs |
|---|---|
| "What I owe the warehouse" (read-only) | `GET /shops/:id/debts/summary` (`owed_by_shop`) |
| Customers list | `GET /customers?hasDebt=true` |
| Customer detail | `GET /customers/:id`, `GET /customers/:id/debts`, `GET /customers/:id/summary` |
| Collect from a customer | `POST /customers/:id/payments` |
| Sell on credit | `POST /receipts` with `customerId` + `paidAmount` |
| Reverse a customer payment | `POST /debts/:id/payments/:paymentId/reverse` |
| Receivables & aging | `GET /analytics/receivables`, `GET /analytics/receivables/aging` |

### Employee
| Page | Key APIs |
|---|---|
| Customers list | `GET /customers` |
| Sell on credit / collect payment | `POST /receipts`, `POST /customers/:id/payments` |
| Receivables (customer debts only) | `GET /analytics/receivables` |

No "reverse payment", no customer deactivation, no order-debt visibility for
employees — omit those actions from their UI entirely rather than relying on
the `403` to hide them.

---

## 12. Worked Example (end to end)

A shop owner sells 30.00 of goods to a known customer who pays 10.00 on the
spot, then pays off the rest a week later.

```
1. POST /customers                              { name: "Ali", phone: "0999" }
   → { id: 7, ... }

2. POST /receipts
   { items: [...], customerId: 7, paidAmount: "10.00" }
   → { id: 21, total_price: 30, debt: { id: 8, remaining: "20.00", status: "PARTIAL" } }

   UI: show a "20.00 remaining" badge on this receipt / on Ali's profile.

3. (one week later) GET /customers/7/summary
   → { total_remaining: "20.00", ... }

4. POST /customers/7/payments               { amount: "20.00" }
   → [ { debt_id: 8, amount: "20.00", status: "PAID", remaining: "0.00" } ]

   UI: mark the receipt as fully settled, remove Ali from the "has debt" filter.
```

If Ali also had an older unpaid sale, step 4 with no `debtId` would have paid
that one first automatically (FIFO) — worth a one-line explainer near the
"collect payment" button so it isn't surprising in a support conversation.
