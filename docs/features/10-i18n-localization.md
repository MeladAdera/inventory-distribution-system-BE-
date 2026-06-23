# i18n — Localization

## Overview

Every API error message is translated at the response layer based on the client's requested language.
Services throw translation keys (e.g. `auth.INVALID_CREDENTIALS`) — the exception filter resolves them
to the correct language before the response is sent. No localization logic lives inside services.

Supported languages: **English** (`en`, default) and **Arabic** (`ar`).

---

## How Language Is Detected

The library (`nestjs-i18n`) checks resolvers in priority order:

| Priority | Method | Example |
|---|---|---|
| 1 | Query param | `GET /orders?lang=ar` |
| 2 | `Accept-Language` header | `Accept-Language: ar` |
| fallback | `fallbackLanguage` in config | always `en` |

If the client sends an unsupported language (e.g. `fr`), the response falls back to English.

---

## Request Flow

```
Client sends  Accept-Language: ar
      │
      ▼
I18nModule middleware detects language → lang = "ar"
Sets req.i18nLang = "ar"
      │
      ▼
Service throws:
  throw new NotFoundException('users.NOT_FOUND')           ← simple key
  throw new BadRequestException({                          ← key + dynamic args
    key: 'orders.INSUFFICIENT_STOCK',
    args: { requested: 5, available: 2 }
  })
      │
      ▼
HttpExceptionFilter.catch()
  resolveMessage() → regex /^\w+\.[A-Z_]+$/ matches key
  i18n.translate('users.NOT_FOUND', { lang: 'ar' })
  → "المستخدم غير موجود"
      │
      ▼
{ success: false, statusCode: 404, message: "المستخدم غير موجود", ... }
```

---

## File Structure

Translation files live at the **project root** (not inside `src/`) so they are available
in both dev (`ts-node`) and production (`dist/`) without a build step.

```
i18n/
├── en/
│   ├── common.json      ← shared: NOT_FOUND, FORBIDDEN, UNAUTHORIZED, etc.
│   ├── auth.json
│   ├── users.json
│   ├── orders.json
│   ├── products.json
│   ├── categories.json
│   ├── shops.json
│   ├── inventory.json
│   └── warehouse.json
└── ar/
    └── (same files, Arabic values)
```

Each file is a namespace. Keys are SCREAMING_SNAKE_CASE constants.

---

## Throwing Localized Errors in Services

### Simple key (no dynamic values)

```ts
throw new NotFoundException('users.NOT_FOUND');
throw new UnauthorizedException('auth.INVALID_CREDENTIALS');
throw new ForbiddenException('common.FORBIDDEN');
```

### Key with dynamic args (interpolation)

```ts
throw new BadRequestException({
  key: 'orders.INSUFFICIENT_STOCK',
  args: { product: 'Widget', requested: 5, available: 2 },
});
```

Translation file (`en/orders.json`):
```json
{
  "INSUFFICIENT_STOCK": "Insufficient stock for \"{{product}}\". Requested: {{requested}}, available: {{available}}"
}
```

The filter automatically detects which form was used.

### Plain strings (not translated — avoid in new code)

```ts
throw new BadRequestException('Something went wrong');  // passes through as-is
```

Plain strings that do NOT match `namespace.KEY` pattern are passed through untouched,
which keeps backward compatibility but loses translation support.

---

## Adding a New Language

1. Create `i18n/<lang>/` folder (e.g. `i18n/fr/`)
2. Copy all JSON files from `i18n/en/` and translate the values
3. No code changes required — `nestjs-i18n` picks up new language folders automatically

---

## Adding a New Translation Key

1. Add the key to the appropriate namespace file in **both** `en/` and `ar/` (and any other languages)
2. Throw it from the service: `throw new NotFoundException('products.NOT_FOUND')`
3. The filter translates it automatically — no other changes needed

---

## Key Architecture Decisions

**Why keys in services, not `I18nService` injection?**
Services are unaware of HTTP or language. They throw a semantic key and let the HTTP layer
(the filter) handle presentation. This keeps business logic clean and testable without
needing to mock `I18nService` in every service test.

**Why `APP_FILTER` instead of `useGlobalFilters()`?**
`useGlobalFilters(new Filter())` creates the filter with plain `new` — outside NestJS's DI
container — so `I18nService` cannot be injected. `APP_FILTER` creates the filter inside the
DI container, enabling full dependency injection.

**Why translation files at the project root, not in `src/`?**
When `AppModule` runs, `__dirname` resolves to `src/` in dev mode and `dist/` in production.
`join(__dirname, '../i18n/')` therefore always resolves to the project root in both environments.
Files in `src/i18n/` would require a build-copy step to reach `dist/i18n/`.

---

## CORS

`Accept-Language` is explicitly listed in the CORS `allowedHeaders` so browsers allow frontends
to send it cross-origin:

```ts
allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
```
