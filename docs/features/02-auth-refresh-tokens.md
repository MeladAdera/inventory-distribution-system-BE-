# Auth — Refresh Tokens

## Overview

Stateful refresh token system layered on top of the existing JWT access token auth.
Every login issues a short-lived **access token** (15 min) and a long-lived **refresh token** (30 days).
The refresh token is stored as a SHA-256 hash in the `refresh_tokens` table — the raw token is never persisted.

---

## Token Lifecycle

```
LOGIN
  POST /auth/login
    → issues accessToken (15 min JWT)
    → generates rawToken = randomUUID()
    → stores SHA-256(rawToken) in refresh_tokens
    → returns { accessToken, refreshToken: rawToken, user }

REFRESH  (token rotation)
  POST /auth/refresh  { refreshToken }
    → hash incoming token
    → SELECT from refresh_tokens WHERE hash = ? AND revoked_at IS NULL AND expires_at > NOW()
    → validate user/shop still active
    → BEGIN TRANSACTION
        UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = old_id
        INSERT INTO refresh_tokens (new row)
      COMMIT
    → sign new accessToken
    → return { accessToken, refreshToken: newRawToken }

LOGOUT
  POST /auth/logout  (requires Bearer accessToken)
    → UPDATE refresh_tokens SET revoked_at = NOW()
       WHERE user_id = ? AND revoked_at IS NULL
    → returns 204 No Content
```

---

## Database Table

```sql
CREATE TABLE refresh_tokens (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,       -- SHA-256 of raw token
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at  TIMESTAMPTZ NULL            -- NULL = still valid
);
```

Migration: `src/database/migrations/11-AddRefreshTokenHash.sql`

---

## Security Properties

| Property | How |
|---|---|
| Tokens never stored in plain text | SHA-256 hash only; raw token returned once and forgotten |
| Replay attack prevention | Rotation — old row is revoked atomically before new row is inserted |
| DB leak safe | SHA-256 hash of a UUID is not reversible / dictionary-attackable |
| All-device logout | `revokeAllForUser()` sets `revoked_at` on every active row for the user |
| Expiry enforced at DB level | `expires_at > NOW()` in every lookup query |
| Cascade delete | `ON DELETE CASCADE` — tokens are cleaned up when a user is deleted |
| Atomic rotation | `RefreshTokensRepository.rotate()` wraps revoke + insert in a single transaction |

---

## Token Format

- **Access token**: standard JWT, signed with `JWT_SECRET`, expires in `15m`
- **Refresh token**: opaque UUID (`randomUUID()`), stored as `SHA-256` hex digest

The refresh token is intentionally opaque — it carries no claims, so there is nothing to forge.

---

## Environment Variables

| Variable | Example | Description |
|---|---|---|
| `REFRESH_TOKEN_SECRET` | `change-me` | Not used for signing (opaque tokens); reserved for future HMAC variant |
| `REFRESH_TOKEN_EXPIRATION_DAYS` | `30` | How many days until a refresh token expires |

---

## File Map

```
src/auth/
├── auth.service.ts
│   ├── login()                  issues both tokens
│   ├── refresh()                validates, rotates, returns new pair
│   ├── logout()                 revokes all tokens for user
│   ├── generateRefreshToken()   create first token (login path)
│   ├── rotateRefreshToken()     atomic rotation (refresh path)
│   └── refreshExpiresAt()       shared expiry helper
├── repositories/
│   └── refresh-tokens.repository.ts
│       ├── create()             insert new token row
│       ├── findValid()          lookup by hash (active + not expired)
│       ├── revoke()             set revoked_at by row id
│       ├── revokeAllForUser()   logout — kill all active rows for user
│       └── rotate()             atomic: revoke old + insert new in one TX
└── dto/
    └── refresh-token.dto.ts     { refreshToken: string }
```

---

## Endpoint Reference

### `POST /auth/login`
Public. Rate-limited to 5 req/min per IP.

**Request:**
```json
{ "email": "admin@warehouse.com", "password": "Admin@123" }
```

**Response `200`:**
```json
{
  "accessToken": "<JWT>",
  "refreshToken": "<UUID>",
  "user": { "id": 1, "name": "...", "email": "...", "role": "WAREHOUSE_ADMIN", "shopId": 1 }
}
```

---

### `POST /auth/refresh`
Public (no Bearer header needed — the refresh token is the credential).

**Request:**
```json
{ "refreshToken": "<UUID from login or last refresh>" }
```

**Response `200`:**
```json
{ "accessToken": "<new JWT>", "refreshToken": "<new UUID>" }
```

**Errors:**
- `401` — token not found, already revoked, or expired
- `401` — user or shop has been deactivated

---

### `POST /auth/logout`
Requires `Authorization: Bearer <accessToken>`.

**Response `204 No Content`** — no body.

---

### `GET /auth/me`
Requires `Authorization: Bearer <accessToken>`.

**Response `200`:**
```json
{ "id": 1, "email": "...", "role": "WAREHOUSE_ADMIN", "shopId": 1 }
```
