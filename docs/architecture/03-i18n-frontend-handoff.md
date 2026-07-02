# i18n — Frontend Integration Guide

## What Changed

All API error messages are now translated server-side. The frontend no longer needs to
map error codes to display strings — the `message` field in every error response is
already in the user's language.

Supported languages: **English** (`en`, default) and **Arabic** (`ar`).

---

## How to Request a Language

Send one of these with every request. The backend checks them in this order:

### Option 1 — HTTP Header (recommended)

```http
Accept-Language: ar
```

Set this once on your HTTP client (Axios, fetch, etc.) and every request is covered:

```js
// Axios example
axios.defaults.headers.common['Accept-Language'] = 'ar';

// fetch example
fetch(url, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept-Language': 'ar',
  }
});
```

### Option 2 — Query Parameter

Append `?lang=ar` to any URL:

```
GET /orders?lang=ar
GET /orders?page=1&limit=10&lang=ar
```

Useful for quick testing in a browser or Postman.

---

## What the Response Looks Like

Error responses always have this shape — only `message` changes based on language:

```json
{
  "success": false,
  "statusCode": 404,
  "message": "المستخدم غير موجود",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "path": "/users/99"
}
```

The same request without `Accept-Language: ar` returns:

```json
{
  "success": false,
  "statusCode": 404,
  "message": "User not found",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "path": "/users/99"
}
```

No other field changes — only `message`.

---

## CORS

`Accept-Language` is already listed in the backend's CORS `allowedHeaders`. No additional
backend changes are needed to send this header from a browser-based frontend.

---

## All Error Messages — English & Arabic Reference

Use this table to know exactly what message to expect for each scenario.

### Common (any endpoint)

| Scenario | EN | AR |
|---|---|---|
| Not authenticated | `Authentication is required` | `المصادقة مطلوبة` |
| No permission for this action | `You do not have permission to perform this action` | `ليس لديك صلاحية لتنفيذ هذا الإجراء` |
| Unhandled server crash | `An unexpected error occurred` | `حدث خطأ غير متوقع` |
| Validation failed (invalid body) | `Validation failed` | `فشل التحقق من البيانات` |

### Auth

| Scenario | EN | AR |
|---|---|---|
| Wrong email or password | `Invalid credentials` | `بيانات الاعتماد غير صحيحة` |
| Account deactivated | `Your account has been deactivated` | `تم تعطيل حسابك` |
| Shop deactivated | `Your shop has been deactivated` | `تم تعطيل متجرك` |
| Access token expired | `Session expired, please log in again` | `انتهت الجلسة، يرجى تسجيل الدخول مجدداً` |
| Access token invalid | `Invalid or expired token` | `رمز غير صالح أو منتهي الصلاحية` |
| Refresh token invalid | `Invalid refresh token` | `رمز التحديث غير صالح` |
| Refresh token expired | `Refresh token has expired, please log in again` | `انتهت صلاحية رمز التحديث، يرجى تسجيل الدخول مجدداً` |

### Users

| Scenario | EN | AR |
|---|---|---|
| User not found | `User not found` | `المستخدم غير موجود` |
| Email already in use | `A user with this email already exists` | `يوجد مستخدم بهذا البريد الإلكتروني مسبقاً` |
| Trying to deactivate self | `You cannot deactivate your own account` | `لا يمكنك تعطيل حسابك الخاص` |
| No update fields sent | `No fields provided to update` | `لم يتم تقديم أي حقول للتحديث` |
| Shop owner updating non-employee | `Shop owners can only update their own employees` | `يمكن لمالك المتجر تعديل موظفيه فقط` |
| Shop owner deactivating non-employee | `Shop owners can only deactivate their own employees` | `يمكن لمالك المتجر تعطيل موظفيه فقط` |
| Shop owner activating non-employee | `Shop owners can only activate their own employees` | `يمكن لمالك المتجر تفعيل موظفيه فقط` |

### Shops

| Scenario | EN | AR |
|---|---|---|
| Shop not found | `Shop not found` | `المتجر غير موجود` |
| Shop name already taken | `A shop with this name already exists` | `يوجد متجر بهذا الاسم مسبقاً` |
| Shop is deactivated | `This shop has been deactivated` | `تم تعطيل هذا المتجر` |
| Viewing another shop | `You can only view your own shop` | `يمكنك عرض متجرك الخاص فقط` |
| Updating another shop | `You can only update your own shop` | `يمكنك تعديل متجرك الخاص فقط` |

### Categories

| Scenario | EN | AR |
|---|---|---|
| Category not found | `Category not found` | `الفئة غير موجودة` |
| Category name already taken | `A category with this name already exists` | `يوجد فئة بهذا الاسم مسبقاً` |
| Deleting category with products | `Cannot delete a category that still has products` | `لا يمكن حذف فئة تحتوي على منتجات` |
| Managing another shop's category | `You can only manage categories for your own shop` | `يمكنك إدارة فئات متجرك الخاص فقط` |

### Products

| Scenario | EN | AR |
|---|---|---|
| Product not found | `Product not found` | `المنتج غير موجود` |
| Barcode already in use | `A product with this barcode already exists in this shop` | `يوجد منتج بهذا الباركود مسبقاً في هذا المتجر` |
| Category not accessible | `Category not found or not accessible to this shop` | `الفئة غير موجودة أو غير متاحة لهذا المتجر` |
| Accessing another shop's product | `You do not have access to this product` | `ليس لديك صلاحية للوصول إلى هذا المنتج` |
| Modifying another shop's product | `You can only modify products belonging to your own shop` | `يمكنك تعديل منتجات متجرك الخاص فقط` |

### Inventory

| Scenario | EN | AR |
|---|---|---|
| Inventory record not found | `Inventory record not found` | `سجل المخزون غير موجود` |
| Adjustment causes negative stock | `Adjustment would result in negative stock (current: 5, adjustment: -10)` | `سيؤدي التعديل إلى مخزون سالب (الحالي: 5، التعديل: -10)` |
| Accessing another shop's inventory | `You do not have access to this inventory record` | `ليس لديك صلاحية للوصول إلى سجل المخزون هذا` |
| Modifying another shop's inventory | `You can only modify inventory for your own shop` | `يمكنك تعديل مخزون متجرك الخاص فقط` |

> Note: numbers in messages like `(current: 5, adjustment: -10)` reflect actual values from the request.

### Orders

| Scenario | EN | AR |
|---|---|---|
| Order not found | `Order not found` | `الطلب غير موجود` |
| Duplicate products in one order | `Duplicate products in order` | `يوجد منتجات مكررة في الطلب` |
| Product has no warehouse stock record | `Product 7 does not exist in warehouse inventory` | `المنتج 7 غير موجود في مخزون المستودع` |
| Product out of stock | `Product "Widget" is out of stock and cannot be ordered` | `المنتج "Widget" نفذ من المخزون ولا يمكن طلبه` |
| Not enough stock | `Insufficient stock for product "Widget" (available: 3, required: 10)` | `مخزون غير كافٍ للمنتج "Widget" (المتاح: 3، المطلوب: 10)` |
| Cancelling a non-cancellable order | `Cannot cancel an order with status SHIPPED. Only PENDING and PROCESSING orders can be cancelled` | `لا يمكن إلغاء طلب بحالة SHIPPED. يمكن إلغاء الطلبات المعلقة وقيد المعالجة فقط` |
| Invalid status jump | `Invalid transition: PENDING → COMPLETED. Expected next status: PROCESSING` | `انتقال غير صالح: PENDING → COMPLETED. الحالة التالية المتوقعة: PROCESSING` |
| Concurrent update conflict | `Order status was modified by another request. Please retry.` | `تم تعديل حالة الطلب بواسطة طلب آخر. يرجى المحاولة مرة أخرى.` |
| Accessing another shop's order | `You do not have access to this order` | `ليس لديك صلاحية الوصول إلى هذا الطلب` |

> Note: product names, status values, and quantities in messages are dynamic and reflect the actual request.

---

## Testing Without Code Changes

You can test both languages right now using the `?lang=` param in Postman or a browser:

```
GET /users/99?lang=en   →  "User not found"
GET /users/99?lang=ar   →  "المستخدم غير موجود"
```

---

## What the Frontend Does NOT Need to Do

- No client-side message mapping — all messages come translated from the backend
- No backend changes — `Accept-Language` is already in CORS allowed headers
- No special handling for Arabic RTL in error messages — the `message` string itself is correct,
  display direction is a UI concern

---

## Future Languages

Adding a new language (e.g. French) requires only a backend change — adding translation files.
The frontend just needs to start sending `Accept-Language: fr`. No API contract changes.
