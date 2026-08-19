# Supplier Invoice Items (Buy → Stock) — Frontend Handoff

> **Status:** Backend complete and verified (36-check regression suite, all passing).
> **Base URL (dev):** `http://localhost:3001`
> **API Docs (Swagger):** `http://localhost:3001/api`
>
> Supplement to `FRONTEND_HANDOFF.md` (auth, response envelope, pagination)
> and `DEBTS_HANDOFF.md` (supplier bills, payments, cancelling). This file
> covers only what is new.

---

## Table of Contents

1. [What Changed](#1-what-changed)
2. [Endpoints](#2-endpoints)
3. [Request Shape](#3-request-shape)
4. [Response Shape](#4-response-shape)
5. [Rules the Frontend Must Enforce](#5-rules-the-frontend-must-enforce)
6. [Adding a Product That Doesn't Exist Yet](#6-adding-a-product-that-doesnt-exist-yet)
7. [What Happens to Inventory](#7-what-happens-to-inventory)
8. [Error Keys](#8-error-keys)
9. [Cancelling](#9-cancelling)
10. [Suggested UI Flow](#10-suggested-ui-flow)
11. [Worked Example](#11-worked-example)

---

## 1. What Changed

Recording a supplier bill used to be money-only. Putting the goods on the
shelf was a separate trip through `POST /inventory/stock-in`, once per
product, with nothing tying the two together.

Now `POST /suppliers/:id/debts` accepts an optional **`items[]`**. When you
send it, every line is stocked into the shop's inventory at its invoice unit
cost, **in the same transaction as the bill**. One request, or nothing at all
— there is no partial outcome.

**Nothing existing breaks.** `items` is optional; a bill sent without it
behaves exactly as before and comes back with `items: []`. Bills for
services, rent or delivery charges should keep omitting it.

---

## 2. Endpoints

| Method | Path | Change |
|---|---|---|
| `POST` | `/suppliers/:id/debts` | **extended** — optional `items[]` |
| `GET` | `/suppliers/:id/debts/:debtId/items` | **new** — the goods on one bill |

Roles are unchanged: `WAREHOUSE_ADMIN` and `SHOP_OWNER` only. `EMPLOYEE`
gets `403` on both.

---

## 3. Request Shape

```jsonc
POST /suppliers/5/debts
{
  "totalAmount": "1420.00",     // required, string, max 2dp, > 0
  "paidAmount":  "400.00",      // optional, defaults to "0"
  "invoiceNo":   "INV-882",     // optional, unique per supplier while live
  "note":        "delivery 19 Aug",
  "items": [                    // optional; omit for a bill with no goods
    { "productId": 146, "quantity": 21, "unitCost": "50.00" },
    { "productId": 127, "quantity": 10, "unitCost": "20.00" },
    { "productId": 147, "quantity":  5, "unitCost": "34.00" }
  ]
}
```

### Item fields

| Field | Type | Rules |
|---|---|---|
| `productId` | int | Must already exist, be active, and be either this shop's own product or a `WAREHOUSE` catalog product |
| `quantity` | int | `> 0` |
| `unitCost` | **string** | `> 0`, at most 2 decimals. `"0"` is rejected |

**Money is a string, everywhere.** `"50.00"`, not `50.0`. A number is
accepted and coerced, but send strings — floats lose cents at scale, and the
backend compares in exact minor units. Max 200 lines per bill.

---

## 4. Response Shape

`201` returns the debt, plus `remaining`, plus the lines:

```jsonc
{
  "success": true,
  "data": {
    "id": 45,
    "supplier_id": 5,
    "creditor_type": "SUPPLIER",
    "debtor_shop_id": 2,
    "invoice_no": "INV-882",
    "total_amount": "1420.00",
    "paid_amount": "400.00",
    "remaining": "1020.00",
    "status": "PARTIAL",              // OPEN | PARTIAL | PAID | CANCELLED
    "note": "delivery 19 Aug",
    "created_at": "2026-08-19T09:11:42.645Z",
    "items": [
      {
        "id": 5,
        "debt_id": 45,
        "product_id": 146,
        "inventory_id": 11,
        "product_name": "gff",
        "quantity": 21,
        "unit_cost": "50.0000",       // 4dp
        "line_total": "1050.00",      // 2dp, computed by the DB
        "avg_cost": "46.5200",        // cost basis AFTER this purchase
        "sale_price": "63.97"         // shop's current selling price
      }
    ]
  }
}
```

`GET /suppliers/:id/debts/:debtId/items` returns that same `items` array on
its own, with `avg_cost` and `sale_price` read **live** — so an invoice
opened next month shows today's cost basis, not the one this delivery
produced.

### The pair worth showing the user

`avg_cost` is what a unit now costs you; `sale_price` is what you sell it
for. `sale_price` **does not move** when cost moves. If a delivery pushes
`avg_cost` up toward (or past) `sale_price`, margin is being eaten silently.
Surfacing that is the main reason both numbers are on the response — see
[§10](#10-suggested-ui-flow).

---

## 5. Rules the Frontend Must Enforce

Validate these client-side. The backend enforces all of them, but catching
them in the form is a far better experience than a rejected submit.

1. **Lines must sum to `totalAmount` exactly.**
   `Σ (quantity × unitCost) === totalAmount`. No tolerance. Show a running
   total next to the invoice total and block submit while they differ.

2. **`unitCost` must be greater than 0.** Free stock does not belong on a
   bill — nothing is owed for it. Route those through
   `POST /inventory/stock-in` with `unitCost: 0` instead.

3. **No duplicate `productId`.** Merge repeat scans into one line and add up
   the quantity; don't send two lines for the same product.

4. **The supplier must be active.** Don't offer deactivated suppliers in the
   picker. Their history stays readable, but new bills are rejected.

5. **Products must exist before you send the bill** — see [§6](#6-adding-a-product-that-doesnt-exist-yet).

6. **`paidAmount` ≤ `totalAmount`.**

### No tax / shipping / discount field yet

Lines must sum to the total *exactly*, so an invoice with VAT or a delivery
charge on top can't be entered as one itemised bill today. Either fold the
charge into unit costs, or record it as a separate bill with no `items`.
Tell us if this blocks you — the fix is explicit `taxAmount` /
`shippingAmount` fields, not loosening the rule.

---

## 6. Adding a Product That Doesn't Exist Yet

A line takes a `productId`. It cannot create a product, because a product
needs things an invoice line doesn't carry — a category, and a **selling**
price (nothing can derive what you sell for from what you paid).

So it's a two-step flow:

```
POST /products      { name, category_id, price, cost_price?, barcode? }  -> { id }
POST /suppliers/:id/debts   { ..., items: [ { productId: <that id>, ... } ] }
```

**Design the form for this.** A good pattern is an inline "＋ New product"
row in the item picker that opens a small modal (name, category, selling
price, optional barcode), creates the product, and drops it straight into
the line with the id filled in.

**Caveat:** if the bill is then rejected, products created in step 1 stay
behind. Either create them only on submit (right before posting the bill),
or offer an undo. Set `cost_price` to the line's `unitCost` so the catalog
starts out honest.

---

## 7. What Happens to Inventory

Useful for writing helper text and confirmation screens. Three cases, all
handled automatically:

| Situation | Result |
|---|---|
| Shop already stocks the product | Quantity increases; `avg_cost` becomes the **weighted average** of old stock and the new batch |
| Product in the catalog, shop has no stock row | Row is created: `avg_cost` = your invoice price, `sale_price` = the catalog's `price` |
| Row exists but quantity is 0 | `avg_cost` resets cleanly to the new price — the old average is discarded |

The weighted average, if you want to preview it in the UI:

```
newAvg = (currentQty × currentAvg + buyQty × buyCost) / (currentQty + buyQty)
```

Real example: 29 units at 44.0000, buy 21 at 50.00 →
`(29×44 + 21×50) / 50` = **46.5200**, quantity 50.

This is the identical calculation manual stock-in has always used. Buying
the same product again later blends again from the new base.

---

## 8. Error Keys

All errors come back in the standard envelope with a translated `message`
(send `?lang=ar` or the `Accept-Language` header for Arabic).

| Status | Meaning | Suggested handling |
|---|---|---|
| `400` | Lines don't sum to the total — message names both figures | Highlight the totals row |
| `400` | Same product on more than one line | Highlight the duplicate lines |
| `400` | Unit price must be > 0 — message names the product | Focus that line's cost field |
| `400` | Supplier is deactivated | Shouldn't happen if the picker filters correctly |
| `400` | `paidAmount` is more than the total | Focus the paid field |
| `403` | Product isn't available to this shop | Remove the line; it's another shop's private product |
| `404` | Product doesn't exist — message names the id | Remove the line, or create the product first |
| `409` | This supplier already has a live bill under that invoice number | Focus the invoice-number field |

Every one of these rejects the **entire** request. Nothing is written — no
debt, no stock, no partial state. Safe to retry the whole payload after
fixing.

---

## 9. Cancelling

`POST /debts/:id/cancel` still works for bills **without** items.

A bill **with** items **cannot be cancelled at all.** It already moved goods
onto the shelf, and voiding the money while leaving the stock would desync
the two, so the request returns `400`.

> ⚠️ **This is a hard stop, not a "clear the stock and retry".** The backend
> checks whether the bill has line rows — an inventory adjustment does not
> remove those. Once a bill has items, that bill can never be voided under
> the current build.

**What the user can actually do** with a mistyped itemised bill:

- Fix the **quantities** with an inventory adjustment (`PATCH`/adjust on the
  inventory row) — the goods get corrected.
- The **bill stays** on the supplier's account and remains payable. There is
  no way to void the money today.

**UI implications:**

1. Hide or disable the cancel action when `items.length > 0`, and say why —
   don't let the user hit the error and then hunt for a remedy that isn't
   there.
2. Because a mistake is unrecoverable, make the **confirm step before submit**
   carry real weight: show the line count, the total, and which products will
   be stocked. This is the last point at which the user can back out.

A proper cancel-and-restock path — deducting each line's quantity back out
inside the cancel transaction — is designed but not built; it has to handle
stock that has since been sold. Tell us if this is blocking and it moves up.

---

## 10. Suggested UI Flow

**Screen: Record a supplier bill**

1. Pick supplier (active only).
2. Invoice number, date, note.
3. **Line items table** — product picker, quantity, unit cost, line total
   (computed, read-only). "＋ New product" opens the modal from [§6](#6-adding-a-product-that-doesnt-exist-yet).
4. **Running total** vs. the invoice total, with the difference called out
   when they disagree. Submit stays disabled until they match.
5. Amount paid now (defaults to 0 = fully on credit).
6. Submit.

**After success** — this is where the feature earns its keep. Show each line
with its new `avg_cost`, and flag any product whose `sale_price` no longer
leaves a healthy margin:

> **gff** — cost is now **46.52**, you sell at **63.97** · margin 27%
> **بسكوتة 5000** — cost is now **20.00**, you sell at **55.00** · margin 64%

with a shortcut to `PATCH /inventory/:id/price` for anything that looks
wrong. Nothing updates selling prices automatically, so this prompt is the
only thing standing between a supplier price rise and a silently shrinking
margin.

**Bill detail screen** — `GET /suppliers/:id/debts/:debtId/items` for the
goods, alongside the existing payment history.

---

## 11. Worked Example

Buy from supplier 5: 21 × *gff* @ 50.00, 10 × *بسكوتة 5000* @ 20.00,
5 × *rubbi* @ 34.00. Total 1,420.00, pay 400.00 now.

```bash
curl -X POST http://localhost:3001/suppliers/5/debts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "totalAmount": "1420.00",
    "paidAmount":  "400.00",
    "invoiceNo":   "INV-882",
    "items": [
      { "productId": 146, "quantity": 21, "unitCost": "50.00" },
      { "productId": 127, "quantity": 10, "unitCost": "20.00" },
      { "productId": 147, "quantity":  5, "unitCost": "34.00" }
    ]
  }'
```

Result — one bill, `PARTIAL`, `remaining "1020.00"`, and:

| Product | Was | Now |
|---|---|---|
| gff (146) | 29 @ 44.0000 | **50 @ 46.5200** |
| بسكوتة 5000 (127) | 0 @ 43.0000 | **10 @ 20.0000** |
| rubbi (147) | not stocked | **5 @ 34.0000**, sells at 40.00 |

Settle the rest later with the existing endpoint — unchanged:

```bash
curl -X POST http://localhost:3001/suppliers/5/payments \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"amount":"1020.00","debtId":45}'
```

Status becomes `PAID`.
