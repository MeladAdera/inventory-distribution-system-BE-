# Folder Structure - Inventory Distribution System

## Architecture: Feature-Based Hybrid Approach

This project follows a **feature-based modular architecture** inspired by proven NestJS patterns. Each domain has its own module with clear separation of concerns.

```
src/
├── admin/                              # Admin-specific operations
│
├── auth/                               # Authentication & Authorization
│   ├── decorators/                     # @CurrentUser, @Public, etc.
│   ├── dto/                            # Login, Register, JWT payloads
│   ├── guards/                         # JwtAuthGuard, RolesGuard
│   ├── strategies/                     # JWT strategy
│   ├── auth.module.ts
│   ├── auth.service.ts
│   ├── auth.controller.ts
│   └── auth.repository.ts
│
├── common/                             # Shared across all modules
│   ├── constants/                      # App-wide constants
│   ├── decorators/                     # Custom decorators
│   ├── dto/                            # PaginationDto, generic responses
│   ├── filters/                        # HTTP exception filters
│   ├── interceptors/                   # Request/response transformers
│   ├── pipes/                          # Validation pipes
│   └── index.ts                        # Barrel exports
│
├── config/                             # Environment & config
│   └── env.schema.ts                   # Validation schema for env vars
│
├── database/                           # Database setup & utilities
│   ├── base.repository.ts              # Base class for all repos
│   ├── db.module.ts
│   ├── db.provider.ts
│   └── pool-config.ts
│
├── tenant/                             # Tenant infrastructure (if multi-tenant)
│   └── tenant.middleware.ts
│
├── products/                           # Product catalog management
│   ├── dto/
│   │   ├── create-product.dto.ts
│   │   ├── update-product.dto.ts
│   │   └── product-response.dto.ts
│   ├── products.module.ts
│   ├── products.service.ts
│   ├── products.controller.ts
│   ├── products.repository.ts
│   └── products.service.spec.ts
│
├── inventory/                          # Stock & warehouse inventory
│   ├── dto/
│   │   ├── create-inventory.dto.ts
│   │   └── inventory-response.dto.ts
│   ├── inventory.module.ts
│   ├── inventory.service.ts
│   ├── inventory.controller.ts
│   ├── inventory.repository.ts
│   └── inventory.service.spec.ts
│
├── orders/                             # Distribution orders
│   ├── dto/
│   │   ├── create-order.dto.ts
│   │   └── order-response.dto.ts
│   ├── orders.module.ts
│   ├── orders.service.ts
│   ├── orders.controller.ts
│   ├── orders.repository.ts
│   └── orders.service.spec.ts
│
├── warehouses/                         # Distribution centers
│   ├── dto/
│   │   ├── create-warehouse.dto.ts
│   │   └── warehouse-response.dto.ts
│   ├── warehouses.module.ts
│   ├── warehouses.service.ts
│   ├── warehouses.controller.ts
│   ├── warehouses.repository.ts
│   └── warehouses.service.spec.ts
│
├── shipments/                          # Logistics & shipment tracking
│   ├── dto/
│   │   ├── create-shipment.dto.ts
│   │   └── shipment-response.dto.ts
│   ├── shipments.module.ts
│   ├── shipments.service.ts
│   ├── shipments.controller.ts
│   ├── shipments.repository.ts
│   └── shipments.service.spec.ts
│
├── app.module.ts                       # Root module - imports all feature modules
├── app.service.ts
├── app.controller.ts
└── main.ts                             # Application entry point
```

## Module Pattern

Each feature module follows this consistent structure:

```
[feature]/
├── dto/
│   ├── create-[feature].dto.ts        # Create payload
│   ├── update-[feature].dto.ts        # Update payload
│   └── [feature]-response.dto.ts      # Response DTO
├── [feature].module.ts                # Module definition
├── [feature].service.ts               # Business logic
├── [feature].controller.ts            # HTTP endpoints
├── [feature].repository.ts            # Database queries
└── [feature].service.spec.ts          # Unit tests
```

## Key Files by Purpose

| Purpose | Location |
|---------|----------|
| Validation & Transformation | `common/pipes/` |
| Request/Response Handling | `common/interceptors/` |
| Error Handling | `common/filters/` |
| Cross-cutting Concerns | `common/decorators/` |
| Environment Configuration | `config/env.schema.ts` |
| Database Connection | `database/db.provider.ts` |
| Authentication Logic | `auth/auth.service.ts` |
| Business Logic | `[feature]/[feature].service.ts` |
| API Endpoints | `[feature]/[feature].controller.ts` |
| Database Queries | `[feature]/[feature].repository.ts` |

## Import Convention

```typescript
// ✅ DO: Import from barrels
import { PaginationDto } from '@common/dto';

// ✅ DO: Import specific class
import { ProductsService } from './products.service';

// ❌ AVOID: Deep imports from other modules
import { ProductsService } from '../products/products.service';
```

## Adding a New Feature

1. Create folder: `src/[feature]/`
2. Create subfolders: `[feature]/dto/`
3. Create files:
   - `[feature].module.ts`
   - `[feature].service.ts`
   - `[feature].controller.ts`
   - `[feature].repository.ts`
4. Add to `app.module.ts` imports
5. Implement DTOs in `dto/` folder

## Benefits of This Structure

- 🎯 **Clear Boundaries**: Each module owns its domain
- 🔄 **Reusability**: Common utilities in `common/` folder
- 📦 **Scalability**: Easy to add new features
- 🧪 **Testability**: Services, repos, and DTOs are independently testable
- 🚀 **Performance**: Lazy-loaded modules supported
- 📚 **Maintainability**: Clear file organization and naming
