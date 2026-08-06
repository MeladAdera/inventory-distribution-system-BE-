# Cancel Receipt — Feature Documentation

## Overview

Lets a receipt be **voided** after creation. Unlike `is_free` (which only hides revenue but leaves the sale as-is), cancelling a receipt:

- Restores every item's quantity back to `inventory.current_quantity`.
- Removes the receipt entirely from shop profit/consumption analytics — as if the sale never happened.
- Keeps the original receipt and its items untouched for history — nothing is deleted, only flagged.

This is intentionally scoped to **full cancel only**. Returning just some items from a receipt ("partial refund") is a separate, not-yet-built feature.

---

## Business Rules

- A receipt can only be cancelled **once**. A second cancel attempt is rejected with `400` (or `409` if it raced a concurrent cancel request).
- Cancelling restores stock and flips `is_cancelled` inside a **single database transaction** — either both happen, or neither does.
- The conditional update `WHERE is_cancelled = FALSE` is the concurrency guard: if two cancel requests arrive for the same receipt at the same time, only the first one gets a row back and proceeds to restore stock. The second gets `409 Conflict`.
- `reason` is optional free text (max 500 characters) captured at cancel time and stored on the receipt as `cancel_reason`.
- Non-admin users can only cancel receipts belonging to their own shop.
- No time limit — any receipt can be cancelled regardless of age.
- No refund/payment logic is touched — payment tracking does not exist yet in this system.

---

## Role Matrix

| Action | WAREHOUSE_ADMIN | SHOP_OWNER | EMPLOYEE |
|---|---|---|---|
| `PATCH /receipts/:id/cancel` | Any shop | Own shop only (403 otherwise) | Own shop only (403 otherwise) |

Same role set as `POST /receipts` and `PATCH /receipts/:id/free` — no extra restriction beyond ownership.

---

## Endpoints

### PATCH /receipts/:id/cancel

**Request body (optional):**
```json
{
  "reason": "Customer changed their mind"
}
```

**Processing (all inside one transaction):**
1. Load the receipt with its items — `404` if it doesn't exist.
2. Check ownership — `403` if a non-admin requests a different shop's receipt.
3. Check `is_cancelled` — `400` if already cancelled.
4. `UPDATE receipts SET is_cancelled = TRUE, cancelled_at = NOW(), cancelled_by = <user>, cancel_reason = <reason> WHERE id = ? AND is_cancelled = FALSE` — `409` if this returns no row (raced a concurrent cancel).
5. For each item on the receipt: `UPDATE inventory SET current_quantity = current_quantity + quantity WHERE id = ?` — the exact reverse of what receipt creation did.
6. For each item: write one `INVENTORY / CANCELLED` audit log row.
7. Commit. Re-fetch and return the full receipt.

**Response `200`:**
```json
{
  "id": 5,
  "shop_id": 2,
  "created_by": 7,
  "notes": null,
  "is_free": false,
  "is_cancelled": true,
  "cancelled_at": "2026-07-25T10:15:00.000Z",
  "cancelled_by": 3,
  "cancel_reason": "Customer changed their mind",
  "created_at": "2026-07-20T09:00:00.000Z",
  "total_price": 100,
  "items": [ /* unchanged */ ]
}
```

---

## DTOs

### CancelReceiptDto — `src/receipts/dto/cancel-receipt.dto.ts`

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string | No | Max 500 characters |

---

## Audit Log Integration

Every cancel produces one `audit_logs` row per item, mirroring the shape already used for receipt creation and `setFree`:

| Field | Value |
|---|---|
| `type` | `INVENTORY` |
| `action` | `CANCELLED` |
| `entity_type` | `inventory` |
| `entity_id` | the `inventory.id` of the restored row |
| `receipt_id` | the cancelled receipt's id |
| `quantity` | positive value (e.g. `+5` for 5 units restored) — opposite sign of the `-5` logged at creation |
| `amount` | `quantity * price` — money value of what was restored |
| `notes` | the `reason` sent in the request, if any |
| `shop_id` | the receipt's shop id |
| `user_id` | the user who cancelled it |

All audit log writes happen inside the same transaction as the inventory restores — if any write fails, all roll back.

---

## Schema

Defined in `src/database/migrations/02-CancelReceipt.sql`:

```sql
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS is_cancelled  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by  INTEGER     NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT        NULL;
```

`is_cancelled` defaults to `FALSE`, so every existing receipt is unaffected until explicitly cancelled.

---

## Analytics Impact

Profit/consumption numbers are computed live from `receipts` + `receipt_items` on every request — nothing is cached. Three queries in `src/analytics/repositories/analytics.repository.ts` gained an `AND r.is_cancelled = FALSE` filter so a cancelled receipt drops out of the totals, the same way cancelled orders are already excluded with `WHERE o.status = 'COMPLETED'`:

| Method | Report |
|---|---|
| `getShopProfitSummary` | Revenue / cost / profit totals for a period |
| `getShopProfitTrend` | Revenue / cost / profit chart over time |
| `getShopConsumption` | Per-product consumption leaderboard for a shop |

This is different from `is_free`: a free receipt still counts as a real cost/loss in these reports (stock genuinely left the shop for nothing). A cancelled receipt is excluded entirely — the stock never really left.

---

## Key Design Decisions

### Why a conditional `UPDATE ... WHERE is_cancelled = FALSE` instead of `SELECT ... FOR UPDATE`?

Same pattern already used by `setIsFree`. The `WHERE` clause on the `UPDATE` itself is the lock — if the row was already flipped by a concurrent request, this `UPDATE` matches zero rows and returns `null`, and the caller can distinguish "someone else already cancelled it" from "cancel succeeded" without a separate `SELECT ... FOR UPDATE` step.

### Why is stock restore not guarded by re-checking each inventory row for existence?

`receipt_items.inventory_id` has `ON DELETE CASCADE` to `inventory`. If an inventory row were deleted, its `receipt_items` row would already be gone, so it could never appear in `receipt.items` in the first place. Combined with a positive delta always satisfying `current_quantity + delta >= 0`, the `adjust()` call cannot fail here — the `if (!restored) throw` is a defensive guard, matching the same "should be unreachable" style comment used elsewhere in this codebase (e.g. receipt creation).

### Why store `cancel_reason` on the receipt instead of only in the audit log?

The audit log already receives the reason via its `notes` field, but a shop owner looking at one receipt shouldn't need to cross-reference the audit log table to see why it was cancelled. Storing it directly on `receipts` makes the receipt self-contained, consistent with how `notes` already works for the original sale.

### Why no time limit on cancelling?

Considered and rejected. A time window (e.g. "same day only") would need a rule for what happens to old, wrongly-entered receipts afterward — likely a manual admin override anyway. Relying on role/shop permissions alone keeps the rule simple, and the audit trail (who cancelled what, and why) provides accountability instead of a clock.

---

## File Map

```
src/receipts/
├── controllers/
│   └── receipts.controller.ts            + PATCH /receipts/:id/cancel
├── services/
│   └── receipts.service.ts               + cancel(id, reason, user)
├── repositories/
│   └── receipts.repository.ts            + cancel(id, cancelledBy, reason, client),
│                                          findById/findPaginated select the new columns
├── entities/
│   └── receipt.entity.ts                 + is_cancelled, cancelled_at, cancelled_by,
│                                          cancel_reason (Receipt); + is_cancelled (ReceiptListItem)
└── dto/
    └── cancel-receipt.dto.ts             reason?: string (max 500)

src/analytics/repositories/
└── analytics.repository.ts               getShopProfitSummary, getShopProfitTrend,
                                           getShopConsumption — exclude cancelled receipts

src/database/migrations/
└── 02-CancelReceipt.sql                  is_cancelled, cancelled_at, cancelled_by, cancel_reason
```

---

## Error Keys

| Key | HTTP | Thrown when |
|---|---|---|
| `receipt.NOT_FOUND` | 404 | Receipt ID does not exist |
| `receipt.ACCESS_DENIED` | 403 | Non-admin requests a receipt from a different shop |
| `receipt.ALREADY_CANCELLED` | 400 | Receipt is already cancelled |
| `receipt.ALREADY_CANCELLED` | 409 | Raced a concurrent cancel request between the pre-check and the update |
| `receipt.RESTORE_FAILED` | 400 | Defensive guard — should be unreachable (see Key Design Decisions) |

> See `docs/features/10-i18n-localization.md` for full i18n details. As with the rest of the `receipt.*` keys, these are not yet wired into `i18n/en/*.json` / `i18n/ar/*.json` — they currently resolve to the raw key.
