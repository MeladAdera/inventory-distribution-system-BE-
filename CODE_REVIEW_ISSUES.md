# Code Review — Issues, Bugs & Dirty Code

_Generated: 2026-06-16 · Branch: `main`_

This is a static review of `src/`. Items are grouped by severity. Each entry has a
location, the problem, and a suggested fix. Nothing in this file has been changed in
the code — it is a report only.

---

## 🔴 Critical / Correctness Bugs

### 1. Race condition in order status transition → **double inventory transfer**
**File:** [src/orders/services/orders.service.ts:89-125](src/orders/services/orders.service.ts#L89-L125), [src/orders/repositories/orders.repository.ts:145-154](src/orders/repositories/orders.repository.ts#L145-L154)

`updateStatus` reads the order **outside** any transaction (`findById`, no lock), checks
the `PENDING→PROCESSING→SHIPPED→RECEIVED→COMPLETED` transition in memory, then opens a
transaction to update and (on `RECEIVED`) transfer stock.

There is **no row lock** (`grep` confirms no `SELECT … FOR UPDATE` anywhere) and the
`UPDATE orders SET status=$1 WHERE id=$2` has **no guard on the current status**.

Two concurrent `PATCH …/status = RECEIVED` requests both read `status = SHIPPED`, both
pass validation, both run `transferInventory()` → warehouse stock is **deducted twice**
and the destination shop is **credited twice**. The same pattern allows skipping/replaying
any transition.

**Fix:** Lock and re-validate inside the transaction. Either:
- `SELECT … FROM orders WHERE id=$1 FOR UPDATE` at the top of the tx, re-check status there, **or**
- make the update conditional and idempotent:
  ```sql
  UPDATE orders SET status=$1, updated_at=NOW()
  WHERE id=$2 AND status=$3   -- $3 = expected current status
  RETURNING *
  ```
  and treat 0 rows updated as a conflict (409).

---

### 2. Order creation never validates/reserves stock **quantity**
**File:** [src/orders/services/orders.service.ts:37-72](src/orders/services/orders.service.ts#L37-L72)

`createOrder` only checks that each product **exists** in warehouse inventory
(`existing.length !== productIds.length`). It never compares requested `quantity`
against `current_quantity`, and it does not reserve stock.

Consequences:
- Orders far exceeding available stock are accepted as `PENDING`.
- Stock is only checked at `RECEIVED` (in `transferInventory`), so the order moves
  through `PROCESSING`/`SHIPPED` and then **fails at the last step** with
  "Insufficient warehouse stock", which is a poor and late failure.
- No reservation means multiple pending orders can collectively oversell the same stock.

**Fix:** Validate `inv.current_quantity >= item.quantity` at creation time (and ideally
introduce a reserved-quantity concept) so oversell is rejected up front.

---

## 🟠 High / Security & Robustness

### 3. Unhandled (non-`HttpException`) errors bypass the response envelope
**File:** [src/common/filters/http-exception.filter.ts:3-21](src/common/filters/http-exception.filter.ts#L1-L21)

The filter is `@Catch(HttpException)` only. Any unexpected error (DB error, `TypeError`,
pg connection failure) is **not** caught here, so the client gets the default Nest 500
shape instead of the standardized `{ success:false, statusCode, message, … }` envelope
that the frontend handoff documents. Raw DB errors may also leak in dev.

**Fix:** Add a catch-all `@Catch()` filter (or broaden this one) that maps unknown
errors to a 500 in the same envelope and logs the stack server-side.

### 4. Access tokens are not re-validated against user/shop state
**File:** [src/auth/strategies/jwt.strategy.ts:24-31](src/auth/strategies/jwt.strategy.ts#L24-L31)

`validate()` trusts the JWT payload and never reloads the user. A user who is
**deactivated**, has their **role changed**, or whose **shop is deactivated** keeps full
access until the access token expires (15m). Login/refresh check `is_active` /
`shop_is_active`, but mid-token changes are not enforced.

**Fix:** If 15m is unacceptable, look the user up in `validate()` and reject inactive
users/shops, or keep a revocation/`token_version` check.

### 5. Hardcoded DB credential fallbacks, no pool limits, no SSL
**File:** [src/database/database.service.ts:8-16](src/database/database.service.ts#L8-L16)

```ts
password: process.env.DATABASE_PASSWORD || 'postgres'
```
Silent fallback to `postgres/postgres/localhost` means a misconfigured production deploy
connects somewhere unexpected instead of failing fast. There is also no `max`,
`idleTimeoutMillis`, `connectionTimeoutMillis`, or `ssl` configuration.

**Fix:** Require DB env vars in production (validate in `env.schema.ts`), add pool sizing
and timeouts, and enable SSL for prod.

### 6. Committed weak/default secrets
**Files:** `.env.development`, `.env.example`

`JWT_SECRET=dev-secret-key-not-secure`, `REFRESH_TOKEN_SECRET=dev-refresh-secret-key-not-secure`,
`your-super-secret-jwt-key-change-in-production`. Make sure no `.env` with real secrets is
committed, and document that these must be replaced. (`.env.development` is tracked in git.)

---

## 🟡 Medium / Design & Consistency

### 7. Notifications run after the transaction and can fail the request
**File:** [src/orders/services/orders.service.ts:70](src/orders/services/orders.service.ts#L70), [src/orders/services/orders.service.ts:123](src/orders/services/orders.service.ts#L123), [src/inventory/services/inventory.service.ts:69-71](src/inventory/services/inventory.service.ts#L69-L71)

`notifyOrderCreated` / `notifyStatusChanged` / `notifyLowStock` are `await`ed **after**
the DB transaction has already committed. If the notification insert throws, the client
receives a 500 even though the order/transfer succeeded — misleading, and not retryable
safely (the action already happened).

**Fix:** Either move notification writes inside the transaction, or fire them
best-effort with a logged `.catch()` so a notification failure doesn't fail a completed
business operation.

### 8. `env.schema.ts` doesn't validate refresh-token settings
**File:** [src/config/env.schema.ts:10-66](src/config/env.schema.ts#L10-L66), [src/auth/auth.service.ts:26-29](src/auth/auth.service.ts#L26-L29)

`AuthService` calls `config.getOrThrow('REFRESH_TOKEN_EXPIRATION_DAYS')`, but that key is
**not** in `EnvironmentVariables`, so it's never validated at boot (it throws lazily on
first use instead). Also `REFRESH_TOKEN_SECRET` is present in `.env` files but appears
**unused** — refresh tokens are random UUIDs hashed with SHA-256, not signed JWTs.

**Fix:** Add `REFRESH_TOKEN_EXPIRATION_DAYS` to the schema (required/number); remove
`REFRESH_TOKEN_SECRET` if truly unused.

### 9. `RolesGuard` returns 403 when there's no authenticated user
**File:** [src/auth/guards/roles.guard.ts:18-22](src/auth/guards/roles.guard.ts#L18-L22)

`const { user } = …getRequest()` is read as `any`; if `JwtAuthGuard` didn't run (guard
ordering mistake), `user` is `undefined` and the code throws `Forbidden` (403) rather
than `Unauthorized` (401). Correctness depends entirely on guard order and there's no
type safety on `user.role`.

**Fix:** Type the request user and distinguish "not authenticated" (401) from
"authenticated but wrong role" (403).

### 10. `insertItems` silently defaults missing product price to `'0'`
**File:** [src/orders/repositories/orders.repository.ts:45](src/orders/repositories/orders.repository.ts#L45)

`const price = priceMap.get(item.productId) ?? '0';` — if a product row is missing a
price, the order line is recorded at price 0 with no error. Currently masked because
products are validated to exist, but it's a silent data-integrity hole.

---

## ⚪ Low / Dirty Code & Tooling

### 11. ESLint: 31 errors + 4 warnings
`npx eslint "src/**/*.ts"` reports problems including:
- Unsafe `any` usage in [roles.guard.ts](src/auth/guards/roles.guard.ts), [http-exception.filter.ts](src/common/filters/http-exception.filter.ts), [transform.interceptor.ts](src/common/interceptors/transform.interceptor.ts), [main.ts](src/main.ts).
- `'_' is defined but never used` in the `({ total_count: _, ...row })` discards across
  [inventory.repository.ts:47,85](src/inventory/repositories/inventory.repository.ts#L47), [orders.repository.ts:114](src/orders/repositories/orders.repository.ts#L114), [products.repository.ts:53,85](src/products/repositories/products.repository.ts#L53), [notifications.repository.ts:57](src/notifications/repositories/notifications.repository.ts#L57), [users.repository.ts:102](src/users/repositories/users.repository.ts#L102).
- `Async method has no 'await'` in the stub notifiers [email.service.ts:5](src/notifications/services/email.service.ts#L5), [sms.service.ts:5](src/notifications/services/sms.service.ts#L5), [push.service.ts:5](src/notifications/services/push.service.ts#L5).

### 12. TypeScript check fails on the test file
`npx tsc --noEmit` errors in [src/app.service.spec.ts](src/app.service.spec.ts) —
`Cannot find name 'describe' / 'it' / 'expect' / 'beforeEach'`. `@types/jest` isn't in
the `types` resolution for the main `tsconfig.json`, so spec files don't type-check with
the build config.

**Fix:** Add `"jest"` (or `"node"`+`"jest"`) to `compilerOptions.types`, or exclude
`*.spec.ts` from the build tsconfig and rely on `ts-jest` for tests.

### 13. Notification side-channels are unimplemented stubs
**Files:** [email.service.ts](src/notifications/services/email.service.ts), [sms.service.ts](src/notifications/services/sms.service.ts), [push.service.ts](src/notifications/services/push.service.ts)

All three are `// TODO: Implement …` + `console.log`. They aren't wired into
`NotificationsService` (which only writes DB rows), so email/SMS/push notifications
silently do nothing. Either implement, or remove to avoid the impression they work.

### 14. `main.ts` uses `console.log` and `any`, logs every request
**File:** [src/main.ts:12-13,51-52](src/main.ts#L12-L13)

- Request logger middleware types `req`/`res` as `any` and logs **every** request at info
  level (noisy in prod).
- Startup uses `console.log` instead of the Nest `Logger` already imported.

**Fix:** Use `Logger`, type the middleware (or use a proper logging middleware), and gate
per-request logging behind `LOG_LEVEL`/env.

### 15. Redundant pre-check in `inventory.adjust`
**File:** [src/inventory/services/inventory.service.ts:82-93](src/inventory/services/inventory.service.ts#L82-L93)

The negative-stock check is done twice: once in memory from a **stale, non-transactional**
read (line 82-87) and again via the DB guard inside the tx (line 91-93). The in-memory
check can be wrong under concurrency; only the DB guard is authoritative. Harmless today,
but keep the DB guard as the source of truth and treat the early check as advisory only.

---

## Summary

| # | Severity | Area | One-liner |
|---|----------|------|-----------|
| 1 | 🔴 Critical | Orders | Status transition has no row lock → double inventory transfer |
| 2 | 🔴 Critical | Orders | Order creation never validates stock quantity |
| 3 | 🟠 High | Errors | Non-HttpException errors bypass the response envelope |
| 4 | 🟠 High | Auth | JWT not re-validated against user/shop state |
| 5 | 🟠 High | DB | Hardcoded credential fallbacks, no pool limits/SSL |
| 6 | 🟠 High | Secrets | Weak default secrets committed |
| 7 | 🟡 Medium | Notifications | Post-commit notifications can fail completed requests |
| 8 | 🟡 Medium | Config | Refresh-token env vars not validated; unused secret |
| 9 | 🟡 Medium | Auth | RolesGuard returns 403 instead of 401 when unauthenticated |
| 10 | 🟡 Medium | Orders | Missing product price silently defaults to 0 |
| 11 | ⚪ Low | Lint | 31 ESLint errors |
| 12 | ⚪ Low | Types | tsc fails on spec file (missing jest types) |
| 13 | ⚪ Low | Notifications | Email/SMS/Push are unimplemented stubs |
| 14 | ⚪ Low | Bootstrap | console.log + any + noisy per-request logging |
| 15 | ⚪ Low | Inventory | Redundant stale pre-check before DB guard |

**Highest priority:** fix **#1** and **#2** — they are exploitable correctness bugs that
corrupt inventory counts.
