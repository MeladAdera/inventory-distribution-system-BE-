# App Bootstrap — AppModule & main.ts

## What was done

Wired all feature modules into `AppModule` and configured global middleware in `main.ts` so every HTTP route is reachable and responses have a consistent shape.

---

## AppModule (`src/app.module.ts`)

All 10 feature modules are imported:

| Module | Path |
|---|---|
| `AuthModule` | `src/auth/auth.module.ts` |
| `UsersModule` | `src/users/users.module.ts` |
| `ProductsModule` | `src/products/products.module.ts` |
| `CategoriesModule` | `src/categories/categories.module.ts` |
| `InventoryModule` | `src/inventory/inventory.module.ts` |
| `OrdersModule` | `src/orders/orders.module.ts` |
| `WarehouseModule` | `src/warehouse/warehouse.module.ts` |
| `ShopsModule` | `src/shops/shops.module.ts` |
| `AuditLogsModule` | `src/audit-logs/audit-logs.module.ts` |
| `NotificationsModule` | `src/notifications/notifications.module.ts` |

`ConfigModule` is registered as `isGlobal: true`, so every module can inject `ConfigService` without re-importing it.

The duplicate `JwtModule` / `PassportModule` registrations that were in `AppModule` were removed — `AuthModule` owns them.

---

## main.ts (`src/main.ts`)

### Global pipes
`ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, and `transform` enabled — strips unknown fields and auto-coerces types on every request.

### Global filter — `HttpExceptionFilter`
Source: `src/common/filters/http-exception.filter.ts`

All error responses are shaped as:
```json
{
  "success": false,
  "statusCode": 404,
  "message": "Resource not found",
  "error": "Not Found",
  "timestamp": "2026-06-03T10:00:00.000Z"
}
```

### Global interceptor — `TransformInterceptor`
Source: `src/common/interceptors/transform.interceptor.ts`

All success responses are wrapped as:
```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2026-06-03T10:00:00.000Z"
}
```

### Swagger
Mounted at `/api`. Configured with:
- Title: `Inventory Distribution System`
- Bearer auth support (`Authorization: Bearer <token>` header in the UI)

Access after starting the server: `http://localhost:3000/api`
