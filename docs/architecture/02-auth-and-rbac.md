# Auth, RBAC & Tenant Provisioning

## Overview

JWT-based authentication with role-based access control.
No public registration — all accounts are provisioned by privileged roles.

---

## Roles

| Role | Who | shop_id |
|---|---|---|
| `WAREHOUSE_ADMIN` | Platform owner (Milad) — manages all shops | `NULL` |
| `SHOP_OWNER` | Owner of one specific shop | shop's id |
| `EMPLOYEE` | Employee of one specific shop | shop's id |

Defined in `src/common/enums/user-role.enum.ts`.

---

## Endpoints

### `POST /auth/login` — public
```json
Request:  { "email": "admin@warehouse.com", "password": "Admin@123" }
Response: { "accessToken": "...", "refreshToken": "...", "user": { "id", "name", "email", "role", "shopId" } }
```
Access token expires in **15 minutes**. Refresh token expires in **30 days**.

### `POST /auth/refresh` — public
Rotates the refresh token atomically and issues a new access token.
```json
Request:  { "refreshToken": "<UUID>" }
Response: { "accessToken": "...", "refreshToken": "<new UUID>" }
```
Old token is revoked in the same DB transaction as the new token insert — replay attacks fail immediately.

### `POST /auth/logout` — requires JWT
Revokes all active refresh tokens for the current user (all devices).
Returns `204 No Content`.

### `GET /auth/me` — requires JWT
Returns the authenticated user object decoded from the token.

### `POST /users/shop-owners` — `WAREHOUSE_ADMIN` only
Creates a new shop and its owner in a single atomic transaction.
```json
Request: { "shopName": "MD Market", "ownerName": "Ahmed", "email": "...", "password": "..." }
```

### `POST /users/employees` — `SHOP_OWNER` only
Creates an employee assigned to the calling owner's shop.
```json
Request: { "name": "John Doe", "email": "...", "password": "..." }
```

---

## JWT Payload

```json
{ "sub": 1, "email": "admin@warehouse.com", "role": "WAREHOUSE_ADMIN", "shopId": null }
```

`JwtStrategy.validate()` maps this to `{ id, email, role, shopId }` — available in every handler via `@CurrentUser()`.

---

## Authorization Layer

| File | Purpose |
|---|---|
| `src/auth/guards/jwt-auth.guard.ts` | Validates JWT, attaches user to request |
| `src/auth/guards/roles.guard.ts` | Reads `@Roles()` metadata, throws 403 if role doesn't match |
| `src/auth/decorators/current-user.decorator.ts` | `@CurrentUser()` param decorator |
| `src/auth/decorators/roles.decorator.ts` | `@Roles(UserRole.X)` metadata decorator |

Usage on any route:
```ts
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.WAREHOUSE_ADMIN)
@Post('shop-owners')
createShopOwner(@Body() dto: CreateShopOwnerDto) { ... }
```

---

## Seeded Account

| Field | Value |
|---|---|
| Email | `admin@warehouse.com` |
| Password | `Admin@123` |
| Role | `WAREHOUSE_ADMIN` |

Seeded by migration `05-SeedWarehouseAdmin.sql`.

---

## File Map

```
src/auth/
├── auth.module.ts
├── auth.service.ts          login(), refresh(), logout(), generateRefreshToken(), rotateRefreshToken()
├── auth.controller.ts       POST /auth/login, POST /auth/refresh, POST /auth/logout, GET /auth/me
├── strategies/
│   └── jwt.strategy.ts      validate() → {id, email, role, shopId}
├── guards/
│   ├── jwt-auth.guard.ts
│   └── roles.guard.ts
├── decorators/
│   ├── current-user.decorator.ts
│   └── roles.decorator.ts
├── repositories/
│   └── refresh-tokens.repository.ts   create, findValid, revoke, revokeAllForUser, rotate (tx)
└── dto/
    ├── login.dto.ts
    └── refresh-token.dto.ts

src/users/
├── services/users.service.ts   findByEmail, createShopOwner, createEmployee
├── controllers/users.controller.ts
└── dto/
    ├── create-shop-owner.dto.ts
    └── create-employee.dto.ts
```
