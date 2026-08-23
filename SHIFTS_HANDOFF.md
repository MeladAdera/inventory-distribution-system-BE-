# Employee Shifts, Clock-In & Cash Close — Frontend Handoff

> **Status:** Backend complete and verified against real rows on the dev database.
> **Base URL (dev):** `http://localhost:3001`
> **API Docs (Swagger):** `http://localhost:3001/api`
>
> Supplement to `FRONTEND_HANDOFF.md` (auth, response envelope, pagination) and
> `DEBTS_HANDOFF.md` (customer/supplier payments). This file covers only what is
> new. Implementation detail lives in [`docs/features/20-shifts.md`](docs/features/20-shifts.md).

---

## Table of Contents

1. [What Changed](#1-what-changed)
2. [The Model in One Picture](#2-the-model-in-one-picture)
3. [Endpoints](#3-endpoints)
4. [Opening Hours](#4-opening-hours)
5. [Shift Templates](#5-shift-templates)
6. [Assigning Employees](#6-assigning-employees)
7. [Starting and Ending a Shift](#7-starting-and-ending-a-shift)
8. [Changes to Existing Endpoints](#8-changes-to-existing-endpoints)
9. [History and Reports](#9-history-and-reports)
10. [Error Keys](#10-error-keys)
11. [Rules the Frontend Must Enforce](#11-rules-the-frontend-must-enforce)
12. [Traps — Read This Section](#12-traps--read-this-section)
13. [Suggested UI Flow](#13-suggested-ui-flow)

---

## 1. What Changed

Nothing breaks. Every new field is optional and every new column nullable — a
client that sends nothing behaves exactly as it does today.

**New:** 13 endpoints under `/shifts`.

**Changed:** four existing endpoints accept an optional `shiftSessionId`, and
`Receipt` gains `shift_session_id` and `client_receipt_id`.

**One bug fix you must act on:** `POST /receipts` now accepts
`clientReceiptId`. See [section 8](#8-changes-to-existing-endpoints) — this is
not optional work.

---

## 2. The Model in One Picture

```
Opening hours  →  Shift templates  →  Assignments
(per weekday)     (max 4 / weekday)   (who should work it)
   THE PLAN
                          │  employee starts their shift
                          ▼
                   Shift session   ◀── receipts.shift_session_id
                   THE FACT            debt_payments.shift_session_id
```

**One employee works one shift.** The database enforces one open session per
shop. So "the shop's open shift" and "my open shift" are the same row.

**Weekday `0` = Sunday**, matching JavaScript `getDay()`. No conversion needed.

**All money is a string** — `"50.00"`, never `50.0`. Times are wall-clock
strings in the shop's timezone.

---

## 3. Endpoints

| Method | Path | Owner | Employee |
|---|:---:|:---:|:---:|
| `GET` | `/shifts/opening-hours` | ✅ | ✅ |
| `PUT` | `/shifts/opening-hours` | ✅ | ❌ |
| `GET` | `/shifts/templates` | ✅ | ✅ |
| `POST` | `/shifts/templates` | ✅ | ❌ |
| `PATCH` | `/shifts/templates/:id` | ✅ | ❌ |
| `DELETE` | `/shifts/templates/:id` | ✅ | ❌ |
| `PUT` | `/shifts/templates/:id/assignees` | ✅ | ❌ |
| `GET` | `/shifts/open` | ✅ | ✅ |
| `POST` | `/shifts/open` | ✅ | ✅ |
| `POST` | `/shifts/:id/close` | ✅ | ✅ |
| `GET` | `/shifts/sessions` | ✅ | ❌ |
| `GET` | `/shifts/sessions/:id` | ✅ | own only |
| `GET` | `/shifts/report` | ✅ | ❌ |

`WAREHOUSE_ADMIN` gets **403** on all of them — the role has no shop.

---

## 4. Opening Hours

### `GET /shifts/opening-hours`

Always returns **7 days**, ordered 0–6, whether or not anything is saved. An
unsaved day comes back closed, so you render one shape.

```json
{
  "timezone": "Asia/Damascus",
  "days": [
    { "shop_id": 2, "weekday": 0, "open_time": "00:00:00", "close_time": "00:00:00", "is_closed": true },
    { "shop_id": 2, "weekday": 1, "open_time": "08:00:00", "close_time": "24:00:00", "is_closed": false },
    { "shop_id": 2, "weekday": 5, "open_time": "18:00:00", "close_time": "02:00:00", "is_closed": false }
  ]
}
```

### `PUT /shifts/opening-hours`

Send **all seven days** every time. Partial saves are rejected.

```json
{
  "timezone": "Asia/Damascus",
  "days": [
    { "weekday": 0, "openTime": "00:00", "closeTime": "00:00", "isClosed": true },
    { "weekday": 1, "openTime": "08:00", "closeTime": "24:00" }
  ]
}
```

`timezone` is optional — omit it and the shop's current zone is left alone.

**Two time conventions you must handle:**

| Written | Means |
|---|---|
| `closeTime` **later** than `openTime` | ordinary day |
| `closeTime` **earlier** than `openTime` | trades past midnight (`18:00 → 02:00`) |
| `closeTime` = `"24:00"` | end of day — **not** `"00:00"` |

Accepted input is `HH:MM` or `HH:MM:SS`; responses always use `HH:MM:SS`.

A closed day **keeps its times**. Check `is_closed` — never read `00:00` as
"closed".

---

## 5. Shift Templates

### `GET /shifts/templates`

The whole week, ordered by weekday then position. Each slot carries its length
and its rota.

```json
[
  {
    "id": 1, "shop_id": 2, "weekday": 1, "slot_index": 1,
    "name": "Morning",
    "start_time": "08:00:00", "end_time": "16:00:00",
    "is_active": true,
    "duration_minutes": 480,
    "assignees": [ { "id": 3, "name": "Ahmad" }, { "id": 24, "name": "Sara" } ]
  }
]
```

`duration_minutes` is computed by the server against that day's opening hours —
**do not calculate it yourself.** A `22:00 → 02:00` slot is 240 minutes, not
−1200.

### `POST /shifts/templates`

```json
{ "weekday": 1, "name": "Morning", "startTime": "08:00", "endTime": "16:00" }
```

**Do not send `slot_index`.** The server assigns the lowest free position 1–4.
Two owners editing at once would otherwise both claim the same one.

### `PATCH /shifts/templates/:id`

`name`, `startTime`, `endTime` — all optional. **`weekday` cannot be changed.**
To move a slot to another day, delete it and create it there.

### `DELETE /shifts/templates/:id`

Returns **204**. Soft delete: the slot leaves the grid, its position is freed
for reuse, and its rota is cleared. Past sessions keep naming it.

---

## 6. Assigning Employees

### `PUT /shifts/templates/:id/assignees`

```json
{ "userIds": [3, 24] }
```

**Full replace.** Send the complete list; `[]` clears the slot. Duplicates are
de-duplicated rather than refused.

Returns the template with its updated `assignees`.

**Several employees per slot is allowed and intended** — a weekly template is
worked by whoever is on rota that week, and a colleague covering should not be
flagged as unscheduled. Who works *right now* is settled by the session, not by
this list.

Assignees must be **active `EMPLOYEE`s of this shop**. The owner cannot be
assigned. Rejection names the offending id:

> *User 26 cannot be assigned — assignees must be active employees of this shop*

Fetch candidates with `GET /users?role=EMPLOYEE`.

**Deactivated employees vanish from rosters automatically.** No cleanup call is
needed; reactivating restores them.

---

## 7. Starting and Ending a Shift

### `GET /shifts/open`

The shop's open shift, or `null`. Poll this to drive the sell page gate.

Because one shop has one open shift, this answers both *"is anyone working"* and
*"am I working"* — **compare `user_id` with your own**.

### `POST /shifts/open`

```json
{ "openingFloat": "50.00" }
```

That is the whole body. **Do not send a template id** — the server works out
which slot is running from the shop clock.

Response (`201`):

```json
{
  "id": 27, "shop_id": 2, "user_id": 21,
  "shift_template_id": 10, "shift_template_name": "Sunday Morning",
  "business_date": "2026-08-23",
  "opened_at": "2026-08-23T09:10:29.755Z",
  "closed_at": null, "closed_by": null,
  "opening_float": "50.00",
  "counted_cash": null, "expected_cash": null, "cash_difference": null,
  "cash_sales": null, "cash_collections": null, "cash_payouts": null,
  "is_off_schedule": true,
  "notes": null, "client_session_id": null,
  "status": "OPEN",
  "user_name": "Idem Test Owner"
}
```

- `shift_template_name` is `null` when no slot was running.
- `is_off_schedule` is `true` when nothing was running **or** the person is not
  on that slot's rota. It is **information, never a block**.

**If someone else's shift is open**, you get `409` naming them:

> *Shift Test Employee's shift is still open. Count the drawer and close it
> before starting a new shift*

Do not dead-end here. Offer to close their shift — see
[section 13](#13-suggested-ui-flow).

### `POST /shifts/:id/close`

```json
{ "countedCash": "165.00", "notes": "five short" }
```

Response is **the same shape** as `GET`, now populated:

```json
{
  "id": 28, "status": "CLOSED",
  "closed_at": "2026-08-23T09:12:09.627Z", "closed_by": 21,
  "opening_float": "50.00",
  "cash_sales": "120.00",
  "cash_collections": "0.00",
  "cash_payouts": "0.00",
  "expected_cash": "170.00",
  "counted_cash": "165.00",
  "cash_difference": "-5.00",
  "notes": "five short",
  "user_name": "Idem Test Owner",
  "shift_template_name": "Sunday Morning"
}
```

The five cash figures are **frozen at close and never recalculated**. Cancelling
a receipt next week will not move them.

**Read the difference as:** negative = short, positive = over, `"0.00"` = balanced.

**Anyone in the shop may close any shift.** There is no "not your session" error
— do not build handling for one. `closed_by` tells you who counted; when it
differs from `user_id`, show both.

---

## 8. Changes to Existing Endpoints

### `POST /receipts` — `clientReceiptId` **(required work)**

This fixes a bug that is live today. `POST /receipts` writes the receipt, its
items, the stock changes and any debt in one transaction. If that transaction
commits but the response is lost — a slow connection, a request timeout, an
offline queue replaying — the retry rings the **whole sale up again**. The
duplicate is complete and consistent, so nothing looks broken; the shop is
simply short of stock with no explanation.

**Send a UUID you generate once per sale, and reuse it on every retry:**

```json
{
  "items": [ { "inventoryId": 11, "quantity": 2 } ],
  "clientReceiptId": "f0b0c1e2-3d4a-4b5c-8d9e-0f1a2b3c4d5e"
}
```

Sending the same id again returns the **original** receipt instead of creating
a second one. Verified: five concurrent identical requests produce one receipt
and one stock movement.

**Send it on every sale, not only offline replays.** A normal online sale on a
slow connection hits exactly the same failure.

### `POST /receipts` — `shiftSessionId` (optional)

**Omit it for normal sales.** The server attaches the shop's open shift.

**Send it when replaying an offline sale.** By the time the queue drains the
shift may have closed and another opened, and resolving on arrival would file
the money under the wrong drawer. A sale **may** name a closed shift; that is
the point.

`Receipt` responses now include `shift_session_id` and `client_receipt_id`.

### `POST /customers/:id/payments` — `shiftSessionId` (optional)

**Omit it.** Cash in — the server attaches the open shift automatically.

### `POST /suppliers/:id/payments` — `shiftSessionId` **(you must ask)**

Money going **out**. Only the person paying knows whether the notes came from
the till or the shop safe, and the server will not guess.

> **Your UI must ask: "Where did this cash come from — the till, or the safe?"**
>
> - **The till** → send `shiftSessionId` (the open shift's id)
> - **The safe** → send nothing

Guessing wrong makes the employee on shift look short by that amount for money
they never touched. This endpoint requires an **open** shift id.

### `POST /debts/:id/payments/:paymentId/reverse` — `shiftSessionId`

Same rule, same question. The cash leaves **today's** drawer, not the one that
originally took it in — so never inherit the original payment's session.

---

## 9. History and Reports

### `GET /shifts/sessions`

Paginated, newest trading day first. Filters: `from`, `to` (business dates),
`userId`, `status` (`OPEN` | `CLOSED`), plus `page` / `limit`.

Each row is a session plus:

```json
{ "receipt_count": 1, "sales_total": "100.00" }
```

### `GET /shifts/sessions/:id`

One shift with the receipts behind it. Owner sees any; an employee sees only
shifts they worked (**403** otherwise).

```json
{
  "…session fields…": "…",
  "receipt_count": 1,
  "sales_total": "100.00",
  "receipts": [
    {
      "id": 64, "created_at": "2026-08-23T08:55:00.000Z",
      "created_by": 22, "created_by_name": "Shift Test Employee",
      "customer_name": null,
      "is_free": false, "is_cancelled": false,
      "on_credit": false,
      "total_price": "100.00"
    }
  ]
}
```

A receipt cancelled **after** the close still appears here, marked
`is_cancelled`, while the frozen totals show what was counted on the night. Both
are true.

### `GET /shifts/report`

Optional `from` / `to`.

```json
{
  "from": null, "to": null,
  "by_employee": [
    { "user_id": 22, "user_name": "Sara", "shifts": 2, "receipt_count": 2,
      "sales_total": "200.00", "cash_difference": "-10.00", "short_shifts": 1 }
  ],
  "by_shift": [
    { "shift_template_id": 10, "shift_template_name": "Sunday Morning", "weekday": 0,
      "shifts": 1, "receipt_count": 1, "sales_total": "50.00", "cash_difference": "-5.00" }
  ]
}
```

`shift_template_name` is `null` for sessions opened with no slot running — label
that group *"outside any shift"*.

**Sales are attributed by who rang them up** (`created_by`); **cash differences
by whose shift it was**. An owner selling during Sara's shift shows as the
owner's sale but lands in Sara's drawer.

---

## 10. Error Keys

Localised server-side. Render `getErrorMessage(err)` verbatim.

| Key | HTTP | When |
|---|:---:|---|
| `shift.SHOP_REQUIRED` | 403 | account has no shop |
| `shift.OPENING_HOURS_INCOMPLETE` | 400 | not 7 distinct weekdays |
| `shift.INVALID_OPENING_HOURS` | 400 | open time equals close time |
| `shift.INVALID_TIMEZONE` | 400 | unknown IANA zone |
| `shift.TEMPLATE_NOT_FOUND` | 404 | no such slot in this shop |
| `shift.SLOT_LIMIT_REACHED` | 400 | a 5th slot on one weekday |
| `shift.DAY_CLOSED` | 400 | adding a slot to a closed day |
| `shift.OUTSIDE_OPENING_HOURS` | 400 | slot outside that day's hours |
| `shift.SLOTS_OVERLAP` | 400 | overlaps another slot (names it) |
| `shift.INVALID_SLOT_WINDOW` | 400 | start equals end |
| `shift.ASSIGNEE_NOT_EMPLOYEE` | 400 | not an active employee here (names the id) |
| `shift.SESSION_ALREADY_OPEN` | 409 | another shift is open (**names the person**) |
| `shift.SESSION_NOT_OPEN` | 409 | closing a closed shift, or naming one interactively |
| `shift.SESSION_NOT_FOUND` | 404 | no such session in this shop |
| `shift.SESSION_ACCESS_DENIED` | 403 | employee reading someone else's shift |

`shift.NOT_SESSION_OWNER` from the original draft contract **does not exist**.

---

## 11. Rules the Frontend Must Enforce

Nothing here is a substitute for the server checks — these are for a good UX,
not for correctness.

1. **Weekday 0 is Sunday.** Everywhere.
2. **Send all 7 days** on `PUT /shifts/opening-hours`.
3. **Never send `slot_index`** when creating a template.
4. **Never compute shift length yourself** — use `duration_minutes`.
5. **`24:00` is a valid time** and is not `00:00`.
6. **Money is a string** with exactly two decimals. Negative floats and counts
   are rejected as malformed.
7. **Ask where supplier cash came from.** Till or safe.
8. **Send `clientReceiptId` on every sale.**
9. **Do not show `expected_cash` before the close.** It is deliberately not
   exposed mid-shift — showing what the till *should* hold invites typing it
   back in, which is not a count.

---

## 12. Traps — Read This Section

### `sales_total` and the cash figures are different numbers

A shift can show `sales_total: "100.00"` and `expected_cash: "50.00"` and be
perfectly correct. That is a credit sale: 100 was **sold**, but only the 30 down
payment plus a 20 float reached the **drawer**.

**If your UI puts those two in the same column, every credit sale will look like
a discrepancy.** Label them clearly — *"Sold"* vs *"In the drawer"*.

### The close response has no `breakdown` object

The five cash fields sit at the top level: `opening_float`, `cash_sales`,
`cash_collections`, `cash_payouts`, `expected_cash`, `counted_cash`,
`cash_difference`. One shape for every session read.

### The owner is always `is_off_schedule: true`

Owners are never on a rota. If you render that flag as a warning badge, every
owner shift will carry one. Consider suppressing it for `SHOP_OWNER`, or say
*"outside a scheduled shift"* rather than *"unscheduled — check this"*.

### A shift crossing midnight has a business date of the day it **started**

A shift opened 23:30 Friday and closed 02:00 Saturday has
`business_date: "2026-08-21"` (Friday). Group history by `business_date`, not by
`opened_at`.

Separately: a shift **opened** at 00:30 Saturday may attach to **Friday's**
late-night template while carrying Saturday's business date. Both are correct.

### Touching shifts do not overlap

`08:00–16:00` and `16:00–24:00` are adjacent, not conflicting. Do not add a
client-side guard that rejects them.

---

## 13. Suggested UI Flow

### `/client/shifts` — owner

1. **Opening hours card** — 7 rows, each with open/close/closed. A *"Split into
   2 / 3 / 4"* helper that pre-fills equal slots is the client's actual ask.
2. **Week grid** — 7 columns × up to 4 slots. Each cell: name, times,
   `duration_minutes`, assignee avatars. *Add* is disabled at 4.
3. **Slot editor** — name, start, end. Show the day's opening hours as the
   boundary. Let the server judge overlap; render its message.
4. **Assign modal** — multi-select from `GET /users?role=EMPLOYEE`, save the
   whole list.

### `/client/my-shift` — employee and owner

Poll `GET /shifts/open`.

| State | Show |
|---|---|
| `null` | **Start my shift** → ask for the opening float |
| open, `user_id` is me | Live shift: template name, opened at, float, **End my shift** |
| open, someone else | *"Ahmad's shift is still open."* → **Count the drawer and close it** |

**Pre-fill the opening float with the previous shift's `counted_cash`.** That is
what keeps the money chain intact from shift to shift, and it is one fetch from
`GET /shifts/sessions?limit=1&status=CLOSED`.

**End my shift** asks for the counted cash *only*. Show the difference **after**
the response comes back — green for `"0.00"`, red for negative.

### Sell page gate

Above the till: if `GET /shifts/open` is `null`, replace the till with **Start
your shift**. Selling without a shift is technically allowed by the API — the
sale just belongs to no drawer — but gating is what makes the cash close mean
anything.

### `/client/shifts/history` — owner

Table from `GET /shifts/sessions` with filters. Columns: date, employee, shift,
opened/closed, sold, expected, counted, difference. Colour the difference.
Row click → detail with the receipt list.

Show `closed_by` whenever it differs from `user_id` — *"closed by Sara"* on
Ahmad's shift is the row an owner most wants to see.
