# Folder Structure - Inventory Distribution System

## Architecture: Feature-Based Modular Approach

This project follows a **feature-based modular architecture** with clear separation of concerns. Each domain has its own module with structured folders for controllers, services, entities, repositories, and DTOs.

```
src/
├── auth/                                # Authentication & Authorization
│   ├── decorators/                      # @CurrentUser, @Roles
│   ├── dto/
│   │   ├── login.dto.ts                 # { email, password }
│   │   └── refresh-token.dto.ts         # { refreshToken }
│   ├── guards/                          # JwtAuthGuard, RolesGuard
│   ├── strategies/
│   │   └── jwt.strategy.ts              # validates bearer token → RequestUser
│   ├── repositories/
│   │   └── refresh-tokens.repository.ts # create, findValid, revoke, revokeAllForUser, rotate (tx)
│   ├── auth.module.ts
│   ├── auth.service.ts                  # login, refresh, logout, generateRefreshToken, rotateRefreshToken
│   └── auth.controller.ts               # POST /auth/login, /auth/refresh, /auth/logout, GET /auth/me
│
├── users/                               # User Management (provisioning + full CRUD)
│   ├── controllers/
│   │   └── users.controller.ts          # POST /users/shop-owners, POST /users/employees,
│   │                                    # GET /users, GET /users/:id,
│   │                                    # PATCH /users/:id, DELETE /users/:id
│   ├── services/
│   │   └── users.service.ts             # createShopOwner (tx), createEmployee,
│   │                                    # findAll, findById, updateUser, deactivateUser
│   ├── repositories/
│   │   └── users.repository.ts          # findByEmail, insertUser, findPaginated,
│   │                                    # findById, update, deactivate
│   ├── entities/
│   │   └── user.entity.ts               # User (with password_hash), SafeUser (without)
│   ├── dto/
│   │   ├── create-shop-owner.dto.ts     # shopName, shopAddress?, ownerName, email, password
│   │   ├── create-employee.dto.ts       # name, email, password
│   │   ├── user-query.dto.ts            # extends PaginationDto + role?, shop_id?, search?
│   │   └── update-user.dto.ts           # name?, email? (at least one required)
│   └── users.module.ts
│
├── shops/                               # Shop/Store Management
│   ├── controllers/
│   │   └── shops.controller.ts          # GET /shops, GET /shops/:id, PATCH /shops/:id, PATCH /shops/:id/status
│   ├── services/
│   │   └── shops.service.ts             # findAll, findById, update, updateStatus — role enforcement
│   ├── repositories/
│   │   └── shops.repository.ts          # findAll, findById, update (dynamic SET), updateStatus
│   ├── entities/
│   │   └── shop.entity.ts               # id, name, address, phone, type, is_active, created_at, updated_at
│   ├── dto/
│   │   ├── update-shop.dto.ts           # name?, address?, phone? — all optional
│   │   └── update-shop-status.dto.ts    # isActive: boolean
│   └── shops.module.ts
│
├── categories/                          # Product Categories (per-shop + global warehouse)
│   ├── controllers/
│   │   └── categories.controller.ts     # GET /categories, GET /categories/:id, POST, PATCH, DELETE
│   ├── services/
│   │   └── categories.service.ts        # findAll, findById, create, update, remove
│   ├── repositories/
│   │   └── categories.repository.ts     # findAll, findAllByShop, findAllForShop, findByNameAndShop, hasProducts
│   ├── entities/
│   │   └── category.entity.ts           # id, shop_id, name, created_at, updated_at
│   ├── dto/
│   │   ├── create-category.dto.ts       # name (required, 3–100)
│   │   └── update-category.dto.ts       # name (optional, 3–100)
│   └── categories.module.ts
│
├── products/                            # Product Catalog (warehouse = global, local = per-shop)
│   ├── controllers/
│   │   └── products.controller.ts       # GET /products, GET /products/:id, POST, PATCH, DELETE
│   ├── services/
│   │   └── products.service.ts          # findAll, findById, create, createForShop, update, remove
│   ├── repositories/
│   │   └── products.repository.ts       # findPaginatedAdmin, findPaginatedForShop, categoryAccessible,
│   │                                    # findByBarcodeAndShop, insert, update, softDelete
│   ├── entities/
│   │   └── product.entity.ts            # id, shop_id, category_id, name, barcode, price,
│   │                                    # source, is_global, is_active, created_at, updated_at
│   ├── dto/
│   │   ├── create-product.dto.ts        # name, price, category_id, barcode?, description?
│   │   ├── update-product.dto.ts        # all optional
│   │   └── product-query.dto.ts         # extends PaginationDto + source?, category_id?, shop_id?
│   └── products.module.ts
│
├── inventory/                           # Stock Management
│   ├── controllers/
│   │   └── inventory.controller.ts      # GET /inventory, GET /inventory/low-stock,
│   │                                    # GET /inventory/:id, POST /inventory/stock-in,
│   │                                    # PATCH /inventory/:id
│   ├── services/
│   │   └── inventory.service.ts         # findAll, findById, stockIn, adjust, getLowStock
│   │                                    # assertReadAccess(), assertWriteAccess()
│   ├── repositories/
│   │   └── inventory.repository.ts      # findPaginated, findAllForAdmin, findById,
│   │                                    # findLowStock, findAllLowStockForAdmin,
│   │                                    # findByShopAndProduct, upsertStockIn, adjust
│   ├── entities/
│   │   └── inventory.entity.ts          # Inventory: id, shop_id, product_id,
│   │                                    # current_quantity, low_stock_threshold, updated_at
│   │                                    # InventoryWithProduct: + product_name, is_low_stock
│   ├── dto/
│   │   ├── stock-in.dto.ts             # productId, quantity, notes?
│   │   ├── adjust-inventory.dto.ts     # adjustment (non-zero int), reason?
│   │   └── inventory-query.dto.ts      # extends PaginationDto + lowStock?, productId?
│   └── inventory.module.ts             # imports DatabaseModule, AuditLogsModule
│
├── orders/                              # Order Management
│   ├── controllers/
│   ├── services/
│   ├── repositories/
│   ├── entities/
│   │   ├── order.entity.ts              # Main order
│   │   └── order-item.entity.ts         # Order line items
│   ├── dto/
│   ├── order-items/                     # Order items sub-module
│   └── orders.module.ts
│
├── warehouse/                           # Central Warehouse (Single)
│   ├── controllers/
│   ├── services/
│   ├── repositories/
│   ├── entities/                        # warehouse.entity.ts
│   ├── dto/
│   └── warehouse.module.ts
│
├── notifications/                       # Multi-Channel Notifications
│   ├── services/
│   │   ├── email.service.ts             # Email notifications
│   │   ├── sms.service.ts               # SMS notifications
│   │   ├── push.service.ts              # Push notifications
│   │   └── index.ts                     # Barrel exports
│   ├── templates/                       # Email/SMS templates
│   ├── dto/
│   └── notifications.module.ts
│
├── audit-logs/                          # System Audit Trail
│   ├── controllers/
│   │   └── audit-logs.controller.ts     # (reserved for future GET /audit-logs endpoint)
│   ├── services/
│   │   └── audit-logs.service.ts        # log(data, client?) — consumed by other modules
│   ├── repositories/
│   │   └── audit-logs.repository.ts     # insert(data, client?) — supports tx client
│   ├── entities/
│   │   └── audit-log.entity.ts          # id, shop_id, user_id, type, action,
│   │                                    # entity_type, entity_id, quantity, amount,
│   │                                    # notes, created_at
│   └── audit-logs.module.ts             # imports DatabaseModule; exports AuditLogsService
│
├── common/                              # Shared Utilities & Infrastructure
│   ├── constants/
│   │   └── app.constants.ts             # App-wide constants
│   ├── decorators/                      # Custom decorators
│   ├── guards/                          # Auth guards
│   ├── interceptors/
│   │   └── transform.interceptor.ts     # Response transformation
│   ├── filters/
│   │   └── http-exception.filter.ts     # Global error handler
│   ├── pipes/                           # Validation pipes
│   ├── middlewares/                     # Custom middlewares
│   ├── utils/
│   │   ├── pagination.util.ts           # Pagination helpers
│   │   └── index.ts
│   ├── dto/
│   │   └── pagination.dto.ts            # Common pagination DTO
│   ├── base/
│   │   └── base.repository.ts           # Base repository class
│   └── index.ts                         # Barrel exports
│
├── config/                              # Configuration & Validation
│   └── env.schema.ts                    # Environment validation schema
│
├── database/                            # Database Setup & Utilities
│   ├── migrations/                      # SQL migration files
│   │   ├── 00-CreateShopsAndUsers.sql
│   │   ├── 01-CreateProductsAndCategories.sql
│   │   ├── 02-CreateInventorySystem.sql
│   │   ├── 03-CreateOrdersSystem.sql
│   │   ├── 04-CreateWalletAndNotifications.sql
│   │   ├── 05-SeedWarehouseAdmin.sql
│   │   ├── 06-AddShopIsActive.sql       # ALTER TABLE shops ADD COLUMN is_active
│   │   ├── 07-AddCategoryUpdatedAt.sql  # ALTER TABLE categories ADD COLUMN updated_at
│   │   ├── 08-LinkWarehouseAdminToShop.sql  # UPDATE users SET shop_id=1 WHERE role='WAREHOUSE_ADMIN'
│   │   ├── 09-AddProductPriceAndSoftDelete.sql  # ADD price, updated_at, is_active; unique barcode index
│   │   ├── 10-AddInventoryLowStockThreshold.sql # ADD low_stock_threshold INTEGER NOT NULL DEFAULT 10
│   │   ├── 11-AddRefreshTokenHash.sql   # CREATE TABLE refresh_tokens (user_id FK, token_hash, expires_at, revoked_at)
│   │   └── runner.ts                    # Migration execution script
│   ├── seeders/                         # Seed data scripts
│   └── factories/                       # Test data factories
│
├── app.module.ts                        # Root module - imports all feature modules
├── app.controller.ts
├── app.service.ts
└── main.ts                              # Application entry point
```

---

## 📋 Feature Module Pattern

Each feature module follows this **consistent structure**:

```
[feature]/
├── controllers/
│   └── [feature].controller.ts          # HTTP endpoints & request handling
├── services/
│   └── [feature].service.ts             # Business logic
├── repositories/
│   └── [feature].repository.ts          # Database queries
├── entities/
│   └── [feature].entity.ts              # Database model definition
├── dto/
│   ├── create-[feature].dto.ts          # Create payload validation
│   ├── update-[feature].dto.ts          # Update payload validation
│   └── [feature]-response.dto.ts        # Response DTO
├── [feature].module.ts                  # Module definition & imports
└── [feature].service.spec.ts            # Unit tests (optional)
```

---

## 🎯 Folder Organization by Purpose

| Purpose | Location |
|---------|----------|
| **Constants** | `common/constants/app.constants.ts` |
| **Pagination** | `common/dto/pagination.dto.ts`, `common/utils/pagination.util.ts` |
| **Global Error Handling** | `common/filters/http-exception.filter.ts` |
| **Response Transformation** | `common/interceptors/transform.interceptor.ts` |
| **Custom Decorators** | `common/decorators/` |
| **Authentication Guards** | `common/guards/` |
| **Environment Config** | `config/env.schema.ts` |
| **Database Migrations** | `database/migrations/` |
| **Authentication Logic** | `auth/auth.service.ts` |
| **Business Logic** | `[feature]/services/[feature].service.ts` |
| **HTTP Endpoints** | `[feature]/controllers/[feature].controller.ts` |
| **Database Access** | `[feature]/repositories/[feature].repository.ts` |
| **Entity/Schema** | `[feature]/entities/[feature].entity.ts` |
| **Validation Rules** | `[feature]/dto/create-[feature].dto.ts` |

---

## 🚀 Module Import Convention

```typescript
// ✅ CORRECT: Import from barrel exports
import { PaginationDto, PaginatedResponse } from '@common/dto';
import { APP_CONSTANTS } from '@common/constants';

// ✅ CORRECT: Import specific class from same module
import { ProductsService } from './services/products.service';
import { ProductsController } from './controllers/products.controller';

// ❌ AVOID: Deep imports from other modules
import { ProductsService } from '../products/services/products.service';

// ❌ AVOID: Importing from nested paths
import { constant } from '../../../common/constants/app.constants';
```

---

## 📐 Data Flow Example: Creating an Order

```
1. Client Request
   ↓ POST /orders
   ↓
2. OrdersController
   → Validates CreateOrderDto
   ↓
3. OrdersService
   → Check user exists (UsersService)
   → Check shop exists (ShopsService)
   → Check inventory (InventoryService)
   → Reserve inventory
   ↓
4. OrdersRepository
   → Save order to database
   → Save order items
   ↓
5. NotificationsService
   → Send email confirmation
   → Send SMS notification
   → Send push notification
   ↓
6. AuditLogsService
   → Log order creation
   ↓
7. Response Transform
   → Wrap in success envelope
   → Include timestamp
   ↓
8. Response to Client
```

---

## ✅ Creating a New Feature Module

### Step 1: Create Folder Structure
```bash
mkdir -p src/[feature]/{controllers,services,repositories,entities,dto}
```

### Step 2: Create Module File
```typescript
// src/[feature]/[feature].module.ts
@Module({
  controllers: [[Feature]Controller],
  providers: [[Feature]Service, [Feature]Repository],
  exports: [[Feature]Service],
})
export class [Feature]Module {}
```

### Step 3: Create Entity
```typescript
// src/[feature]/entities/[feature].entity.ts
export class [Feature] {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Step 4: Create DTOs
```typescript
// src/[feature]/dto/create-[feature].dto.ts
export class Create[Feature]Dto {
  @IsString()
  name: string;
}
```

### Step 5: Create Service
```typescript
// src/[feature]/services/[feature].service.ts
@Injectable()
export class [Feature]Service {
  constructor(private repository: [Feature]Repository) {}
  
  async create(dto: Create[Feature]Dto) {
    return this.repository.create(dto);
  }
}
```

### Step 6: Create Controller
```typescript
// src/[feature]/controllers/[feature].controller.ts
@Controller('[features]')
export class [Feature]Controller {
  constructor(private service: [Feature]Service) {}
  
  @Post()
  create(@Body() dto: Create[Feature]Dto) {
    return this.service.create(dto);
  }
}
```

### Step 7: Add to app.module.ts
```typescript
@Module({
  imports: [
    // ... other modules
    [Feature]Module,
  ],
})
export class AppModule {}
```

---

## 🎁 Benefits of This Structure

- ✅ **Clear Domain Boundaries** - Each module is self-contained
- ✅ **Scalability** - Easy to add new modules without affecting others
- ✅ **Maintainability** - Predictable folder structure
- ✅ **Testability** - Services, repos, and controllers are independently testable
- ✅ **Reusability** - Common utilities shared across all modules
- ✅ **Performance** - Supports lazy-loaded modules
- ✅ **Developer Experience** - Easy to navigate and understand codebase
- ✅ **Production-Ready** - Follows NestJS best practices

---

## 📚 Key Files

- **IMPLEMENTATION_GUIDE.md** - Complete guide with patterns & examples
- **src/database/migrations/runner.ts** - Executes pending migrations
- **src/common/index.ts** - Barrel exports for common utilities
- **src/notifications/services/index.ts** - Barrel exports for notification services
