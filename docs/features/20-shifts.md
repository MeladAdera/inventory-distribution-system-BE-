# Employee Shifts, Clock-In and Cash Close — Implementation Log

> **Status: DONE.** Built across seven migrations and verified end to end
> against real rows on the dev database — including the seven cash cases, the
> overnight boundary, and every access rule. This document is written after the
> fact: it records what was actually built and actually tested.

---

## Overview

The app had no concept of time, schedule, attendance or cash accountability.
`receipts.created_by` said *who* rang up a sale and `created_at` said *when*,
but nothing said which working period a sale belonged to, and nothing compared
the money in the till against the money the system thought was there.

This feature adds three things that build on each other:

1. **The plan** — the shop's trading week, divided into named shifts, with
   employees on them.
2. **The fact** — one session per clock-in, holding the person and the drawer.
3. **The reckoning** — every sale and payment stamped with its shift, and a
   close that compares a hand count against a computed total.

### Example

A shop trades Monday 08:00–24:00. The owner cuts it into *Morning* 08:00–16:00
and *Evening* 16:00–24:00, and puts Ahmad on Morning. Ahmad arrives, starts his
shift with 50.00 already in the drawer, sells 120.00 in cash, and clocks out
counting 170.00.

The system says: expected 170.00, counted 170.00, difference 0.00. Had he
counted 160.00, the shift would be recorded as **10.00 short**, against his
name, permanently.

---

## Decisions Already Made

| # | Question | Decision |
|---|---|---|
| 1 | Recurrence | Weekly template. A shift is "Monday morning" every week — times, no dates. |
| 2 | Shifts per day | Max 4 per weekday, the client's stated requirement. |
| 3 | People per shift | **One employee works one shift.** Enforced as one open session per shop. |
| 4 | Drawer | One shared till, handed from shift to shift. Since one person works at a time, session and drawer are the same row. |
| 5 | Assignment | Several employees *may* sit on one template — rotation, and cover. Who works *now* is settled by the session, not the rota. |
| 6 | Enforcement | Soft. Clocking in outside your slot is allowed and flagged, never blocked. |
| 7 | Who may close | Anyone in the shop. `closed_by` records who counted. |
| 8 | Weekday numbering | `0 = Sunday`, matching JavaScript `getDay()` and Postgres `DOW`. |

### Rejected alternative: splitting attendance from the drawer

An earlier design had two tables — `shift_attendance` for people and
`cash_drawer_sessions` for money — because several employees sharing one till
cannot each count it. That split was correct **only** while more than one
person could work at once. Once the client confirmed one employee per shift,
the two tables described the same event and were merged. The one-open-session
index is what makes the merge safe.

---

## Schema

Seven migrations, `06` through `12`. `06` is a bug fix that shipped with this
work but is independent of it (see *Interaction With Existing Features*).

### `shop_opening_hours` (07)

`(shop_id, weekday)` primary key, `open_time`, `close_time`, `is_closed`.
Also adds `shops.timezone` (IANA, default `Asia/Damascus`).

`close_time` earlier than `open_time` means the day trades past midnight.
Postgres `TIME` also accepts the literal `'24:00:00'`, which is how "open until
end of day" is written without wrapping to zero. **No SQL CHECK on the
ordering** — the crossing case is legitimate, so the shape is decided in code.

A closed day keeps its times, so toggling a day off and back on restores what
the owner had. Readers must check `is_closed`, not read `00:00` as a signal.

### `shift_templates` (08)

`(shop_id, weekday, slot_index 1..4, name, start_time, end_time, is_active)`.

- Partial `UNIQUE (shop_id, weekday, slot_index) WHERE is_active` — retiring a
  slot frees its position for reuse, which a table-level UNIQUE would not.
- Soft delete, because sessions reference the template they were worked under.

### `shift_assignments` (09)

`(shift_template_id, user_id)` unique. Plus an index on `user_id` for the
off-schedule check.

### `shift_sessions` (10, 12)

The fact. Holds `user_id`, the template that was running, `business_date`,
`opened_at`/`closed_at`/`closed_by`, `opening_float`, and the five frozen cash
figures. Two partial unique indexes:

```sql
UNIQUE (shop_id) WHERE status = 'OPEN'   -- one employee works one shift
UNIQUE (user_id) WHERE status = 'OPEN'   -- nobody clocked in twice
```

The first is load-bearing well beyond attendance: it makes "the shop's open
session" a single unambiguous row, which is what lets a sale be attributed
without the client saying which shift it belongs to.

### Attribution (11)

`receipts.shift_session_id` and `debt_payments.shift_session_id`, both
nullable, both indexed. Plus a plain index on `debts(receipt_id)` — the close
must ask whether a receipt has a debt *at all*, and `idx_debts_receipt_unique`
cannot serve it because it is partial on `status <> 'CANCELLED'`.

---

## The Midnight Rule

A weekly schedule stores bare wall-clock times, so a shop trading 18:00–02:00
has windows that invert as plain strings: `'02:00' < '18:00'` claims the day
ends before it starts. Comparing those strings directly is the bug
[`shift-time.util.ts`](../../src/shifts/utils/shift-time.util.ts) exists to
prevent.

Every window converts to **minutes from midnight of the opening day**, which
turns a crossing window into an ordinary ascending range and reduces both
containment and overlap to number comparisons.

The subtle part is that a slot is positioned relative to the **opening window**,
not to midnight. On a Friday trading 18:00–02:00, a shift written `00:00–02:00`
belongs to the small hours at the *end* of that trading day, not to the morning
fourteen hours before it opened. Any start earlier than the opening time is
pushed a day forward before the end is resolved.

Ranges are **half-open**. A shift ending 16:00 and the next starting 16:00 are
adjacent, not overlapping — that is a handover.

### Verified arithmetic

| Window | Opening | Normalised | Length |
|---|---|---|---|
| 08:00 → 16:00 | 08:00–24:00 | `[480, 960]` | 480 min |
| 16:00 → 24:00 | 08:00–24:00 | `[960, 1440]` | 480 min |
| 22:00 → 02:00 | 18:00–02:00 | `[1320, 1560]` | 240 min |
| 00:00 → 02:00 | 18:00–02:00 | `[1440, 1560]` | 120 min |

---

## Which Shift Is Running

A session does not carry a client-supplied template id. The server resolves it
from the shop's own clock — and **can**, because templates on a weekday may not
overlap, so at most one window ever contains a given instant.

The lookup considers **two weekdays**, because at 00:30 the shift still running
belongs to yesterday's trading day. Yesterday's windows are probed against the
current minute *plus a day*:

> Saturday 00:30 = minute 30. Friday's `22:00–02:00` normalises to
> `[1320, 1560]`. `30 + 1440 = 1470`, which lands inside. Match.

Checking only today would flag every late-night session as off-schedule.

`business_date` is derived in SQL from the shop's timezone inside the insert
itself, so it sits on the same clock as `opened_at`. Postgres `NOW()` is the
transaction timestamp, so the clock read and the stamp cannot disagree even
across midnight.

`is_off_schedule` is true when nothing was running, **or** when the person is
not on that slot's rota. A session attaches to the slot actually running, not
the one the person is rostered on: covering a colleague still works that shift,
and the money still belongs to it.

---

## The Cash Formula

```
expected_cash = opening_float
              + cash_sales     -- receipts on this shift, not free, not cancelled,
                               --   AND NOT EXISTS (a debt for that receipt)
              + collections    -- debt_payments, method='CASH', creditor_type='SHOP'
              - payouts        -- debt_payments, method='CASH', creditor_type='SUPPLIER'

cash_difference = counted_cash - expected_cash        (negative = short)
```

Three details each prevent a specific wrong answer:

**`NOT EXISTS (a debt)` is what makes a credit sale work.** A sale paid in full
has no debt row, so its whole total is cash. A credit sale has one, and its cash
arrived as a `debt_payments` row counted in `collections`. Summing both would
report a 100-for-30 credit sale as **130** in the drawer. This is the single
most likely bug in the feature. The check is deliberately unfiltered by debt
status: a cancelled debt still proves the sale was made on credit.

**No `is_reversal` filter anywhere.** Reversals are stored with a negative
amount (`chk_debt_payments_sign`), so `SUM` nets them out. Subtracting them
separately would remove each reversal **twice**.

**`creditor_type` splits money in from money out.** Customer collections and
supplier payments share one table. Without the split, paying a supplier 500 in
cash would *add* 500 to the drawer.

Every term is `numeric`, never `float8`, and leaves SQL as text for bigint minor
units. The receipt list casts totals to float because it is display; this figure
decides whether somebody is accused of being short.

### Freezing

`expected_cash`, `cash_difference`, `cash_sales`, `cash_collections` and
`cash_payouts` are computed once at close and **stored**. Nothing recomputes
them on read. Cancelling a receipt next week must not make last Tuesday's drawer
look short — and storing only the total while recomputing the parts would make
the row visibly stop adding up.

---

## Attribution Rules

A sale belongs to the shop's **open** shift, not the seller's own. When the
owner rings something up during Ahmad's shift, the cash physically lands in
Ahmad's drawer. *Who sold it* stays a separate question, answered by
`receipts.created_by`.

Whether a movement attaches automatically or only when named depends on which
way the money went, and only the entry point knows:

| Movement | Resolver | Why |
|---|---|---|
| `POST /receipts` | automatic | cash in — nowhere else it could go |
| `POST /customers/:id/payments` | automatic | same |
| `POST /suppliers/:id/payments` | **explicit only** | the notes may have come from the safe |
| reverse a payment | **explicit only** | cash leaves *today's* drawer, not the one that took it in |
| `POST /orders/:id/payments` | none | warehouse admin, no shop |

`DebtsService` stays unaware of shifts and persists what it is handed, which
keeps that policy in one layer instead of spread across three flows.

**A credit sale writes two rows** — the receipt and the down payment on its debt
— and they must name the same shift, because the money was handed over once. The
session is resolved once before the transaction and used for both.

**A sale may name a closed shift; an interactive payment may not.** An offline
queue can drain long after a shift ended, and the sale genuinely happened in it;
refusing would lose a real sale. A supplier payment, by contrast, is made by a
person standing at the till now, so a closed id is a typo.

---

## Interaction With Existing Features

### Receipt idempotency (migration 06)

Independent of shifts, but found while designing them and fixed first.
`POST /receipts` does all its work in one transaction; if that transaction
commits but the response is lost, the retry rings the whole sale up again. The
duplicate is complete and internally consistent, so nothing reads as corrupt —
the shop is simply short of stock with no explanation.

`clientReceiptId` (client-generated UUID, reused on every retry) fixes it with
two guards: a lookup before the transaction, and a partial unique index that
catches two retries arriving together. The loser's transaction rolls back whole.

### Debts

`debt_payments` gains `shift_session_id`. The ledger's sign convention
(collections positive, reversals negative) is what lets the close use a single
`SUM` per side.

### Audit log

`type: 'SHIFT'` with `CLOCK_IN` and `CLOCK_OUT`, labelled in both languages.
Shift events sit in the same trail as the sales and payments they explain. The
clock-out records the **difference**, not the total — a shortage is the part
worth finding in a list of events.

### Users

`UsersModule` now exports `UsersRepository`, with one set-based query
(`findActiveEmployeeIdsInShop`) used to validate a whole rota in one round trip.

---

## Verified on the Dev Database

**The seven cash cases**, each a full open → transact → close cycle:

| Case | Result |
|---|---|
| Float 50, sell 120 cash, count 170 | `50 + 120 = 170`, difference **0.00** |
| Same, count 160 | difference **−10.00** |
| **Credit sale 100, pays 30** | `cash_sales 0.00` + `collections 30.00` → **+30**, not 100 |
| Collect 40 cash on an old debt | **+40** |
| Collect 20 by `TRANSFER` | **no movement** |
| Pay supplier 500 cash from the till | **−500** |
| One receipt free, one cancelled, one kept | only the kept sale counted |
| Reverse a 25 collection in its own shift | nets to **0.00**, not −50 |

**The overnight boundary** was exercised end to end by moving the shop to
`Pacific/Auckland`, so its local clock read `00:57 Sunday`. The session
correctly attached to **Saturday's** `22:00–02:00` slot while stamping **Sunday**
as its business date. Both facts are true at once.

**Rules 1–3 on templates**: a fifth slot, a slot before opening, a slot on a
closed day, a zero-length slot, and overlaps in both the ordinary and the
midnight-crossing case are each refused with a translated message. Touching
slots (`08:00–16:00` + `16:00–24:00`) are accepted.

**Freezing**: a shift closed at `expected 150.00` kept those figures after the
receipt behind them was cancelled.

**Access**: employees cannot write the schedule, list sessions or read the
report; they can read their own shift's detail but not the owner's. One shop's
hours, templates, rota, sessions and history are invisible to another. Warehouse
admins are excluded entirely — the role carries no `shop_id`.

---

## Bugs Found and Fixed During Build

**1. Boundary rendered as an empty window.** A day closing at `24:00` was
reported as *"opening hours (08:00 to 00:00)"* because `toTimeString` wrapped
1440 back to zero. An exact day boundary now renders `24:00`.

**2. Offline replay rejected a real sale.** The first cut refused an explicit
session id once the shift had closed — which breaks the exact case the explicit
id exists for. A sale may now name a closed shift; interactive payments still
may not.

**3. Audit logging promised and not delivered.** Listed in the session plan,
absent from the implementation. Added with the close.

**4. Close returned the same figures twice.** The response carried
`cash_sales`/`cash_collections`/`cash_payouts` at the top level *and* a
`breakdown` object using different key names. The breakdown was dropped; close
now returns exactly the shape every other session read returns.

---

## Known Limitations

### 1. The owner is always flagged off-schedule

Owners are never on a rota, so every shift they work sets
`is_off_schedule = true`. This is accurate — nothing scheduled them — but a UI
that renders the flag as a warning will show one on every owner shift.
Suppressing it for `SHOP_OWNER` would be a one-line change if the client finds
it noisy.

### 2. Cancelled sales are treated asymmetrically

Cancelling a **cash** sale removes it from `expected_cash`; cancelling a
**credit** sale leaves its down payment counted. This follows the existing
model — the debt module already tracks collected-then-cancelled money as
`refund_due` precisely because refunds are not built, so that cash is still in
the drawer — but it is a judgement call the client should confirm.

### 3. No offline shift open yet

`shift_sessions.client_session_id` and its unique index exist, but no DTO
accepts the field. A shift opened while offline cannot yet be replayed
idempotently. Sales made offline *can* already name their session.

### 4. `expected_cash` is not exposed before the close

Deliberate: showing the number the till *should* hold invites typing it back in,
which is not a count. It also means a UI cannot show a live "you should have X"
figure mid-shift.

### 5. No shift edit or delete after close

A closed shift is final. A miscounted drawer cannot be corrected, only annotated
by a later note on another shift. Adding a correction path would need its own
audit trail, since overwriting a frozen figure defeats the freeze.

### 6. Templates cannot move between weekdays

`PATCH` changes name and times only. Moving a slot to another day would mean
surrendering a position in one day and claiming one in another against its own
four-slot limit — a different operation wearing the same name. Delete and
recreate.

---

## Files Touched

**New** — `src/shifts/` (controller, service, repository, 6 DTOs, 3 entity
files, `shift-time.util.ts`, module), migrations `06`–`12`,
`i18n/{en,ar}/shift.json`.

**Modified** — receipts (dto, entity, repository, service, module), debts
(service, repository, entity, 2 DTOs, module), customers (service, module),
suppliers (service, module), users (repository, module),
`i18n/{en,ar}/{fields,validation,audit-logs}.json`, `app.module.ts`.
