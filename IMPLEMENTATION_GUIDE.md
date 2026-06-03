# Implementation Guide - Inventory Distribution System

## 📋 Project Overview

This is a **multi-shop inventory distribution system** where:
- Multiple **shops** (retail locations) order products
- Products are stored in a single **warehouse**
- **Inventory** tracks stock levels in the warehouse
- **Orders** are created by users and fulfilled from the warehouse
- **Notifications** alert users about order status via email, SMS, or push
- **Audit logs** track all system changes

---

## 📁 Folder Structure Reference

```
src/
├── auth/                           # Authentication & Authorization
│
├── users/                          # User Management
│   ├── controllers/                # HTTP endpoints
│   ├── services/                   # Business logic
│   ├── entities/                   # User entity
│   ├── dto/                        # Data transfer objects
│   └── users.module.ts
│
├── shops/                          # Shop/Store Management
│   ├── controllers/
│   ├── services/
│   ├── entities/                   # Shop entity
│   ├── dto/
│   └── shops.module.ts
│
├── categories/                     # Product Categories
│   ├── controllers/
│   ├── services/
│   ├── entities/
│   ├── dto/
│   └── categories.module.ts
│
├── products/                       # Product Catalog
│   ├── controllers/
│   ├── services/
│   ├── entities/                   # Example: product.entity.ts
│   ├── dto/
│   └── products.module.ts
│
├── inventory/                      # Stock Management
│   ├── controllers/
│   ├── services/
│   ├── entities/                   # Example: inventory.entity.ts
│   ├── dto/
│   └── inventory.module.ts
│
├── orders/                         # Order Management
│   ├── controllers/
│   ├── services/
│   ├── entities/
│   │   ├── order.entity.ts         # Main order
│   │   └── order-item.entity.ts    # Line items
│   ├── dto/
│   ├── order-items/                # Order items sub-module
│   └── orders.module.ts
│
├── warehouse/                      # Single Warehouse (Central Storage)
│   ├── controllers/
│   ├── services/
│   ├── entities/                   # Example: warehouse.entity.ts
│   ├── dto/
│   └── warehouse.module.ts
│
├── notifications/                  # Notification System
│   ├── email/
│   │   └── services/email.service.ts
│   ├── sms/
│   │   └── services/sms.service.ts
│   ├── push/
│   │   └── services/push.service.ts
│   ├── services/
│   │   ├── email.service.ts        # Email notifications
│   │   ├── sms.service.ts          # SMS notifications
│   │   └── push.service.ts         # Push notifications
│   ├── templates/                  # Email/SMS templates
│   ├── dto/
│   └── notifications.module.ts
│
├── audit-logs/                     # System Audit Trail
│   ├── controllers/
│   ├── services/
│   ├── entities/
│   ├── dto/
│   └── audit-logs.module.ts
│
├── common/                         # Shared Utilities
│   ├── decorators/                 # Custom decorators
│   ├── guards/                     # Auth guards
│   ├── interceptors/               # Request/response transforms
│   ├── utils/                      # Helper functions
│   │   ├── pagination.util.ts      # Pagination helpers
│   │   └── index.ts
│   ├── constants/                  # App constants
│   │   └── app.constants.ts
│   ├── filters/                    # Global error handler
│   │   └── http-exception.filter.ts
│   ├── pipes/                      # Validation pipes
│   └── middlewares/                # Custom middlewares
│
├── config/                         # Configuration
│   └── env.schema.ts               # Environment validation
│
├── database/                       # Database Setup
│   ├── migrations/                 # Database migrations
│   ├── seeders/                    # Seed data
│   └── factories/                  # Test data factories
│
├── app.module.ts                   # Root module
├── main.ts                         # Application entry point
└── ...
```

---

## 🔄 Module Pattern

Every feature module (users, products, etc.) follows this pattern:

### Controller (`[feature].controller.ts`)
```typescript
@Controller('[features]')
export class [Feature]Controller {
  constructor(private [feature]Service: [Feature]Service) {}
  
  @Get()
  findAll() {
    return this.[feature]Service.findAll();
  }
  
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.[feature]Service.findOne(id);
  }
  
  @Post()
  create(@Body() dto: Create[Feature]Dto) {
    return this.[feature]Service.create(dto);
  }
}
```

### Service (`[feature].service.ts`)
```typescript
@Injectable()
export class [Feature]Service {
  constructor(private repository: [Feature]Repository) {}
  
  findAll() {
    return this.repository.findAll();
  }
  
  async create(dto: Create[Feature]Dto) {
    // Business logic
    return this.repository.save(dto);
  }
}
```

### Entity (`entities/[feature].entity.ts`)
```typescript
export class [Feature] {
  id: string;
  name: string;
  // ... other properties
  createdAt: Date;
  updatedAt: Date;
}
```

### DTO (`dto/create-[feature].dto.ts`)
```typescript
export class Create[Feature]Dto {
  @IsString()
  name: string;
  // ... other properties
}
```

### Module (`[feature].module.ts`)
```typescript
@Module({
  controllers: [[Feature]Controller],
  providers: [[Feature]Service],
  exports: [[Feature]Service],
})
export class [Feature]Module {}
```

---

## 📊 Data Flow Example: Creating an Order

```
1. User → POST /orders → OrdersController
                ↓
2. OrdersController → validateDto → OrdersService
                ↓
3. OrdersService → Check inventory → InventoryService
                ↓
4. InventoryService → Update stock → OrdersService
                ↓
5. OrdersService → Save order → Repository
                ↓
6. OrdersService → Send notification → NotificationsModule
                ↓
7. NotificationsModule → Email/SMS/Push → User
                ↓
8. AuditLogsService → Log event
                ↓
9. Response → OrdersController → Client
```

---

## 🚀 Getting Started

### 1. Implement a Module
Start with **Users** or **Products** module:

- [ ] Create `users.service.ts` with business logic
- [ ] Create `users.controller.ts` with HTTP endpoints
- [ ] Create DTOs in `dto/` folder
- [ ] Add database queries in a repository (if needed)
- [ ] Import module in `app.module.ts`

### 2. Add Database Integration
- Create migrations in `database/migrations/`
- Create entities for each module
- Set up repository pattern for data access

### 3. Add Notifications
When orders are created:
- [ ] Send email via `EmailService`
- [ ] Send SMS via `SmsService`
- [ ] Send push via `PushService`

### 4. Add Audit Logging
Track all important actions:
- [ ] Order creation
- [ ] Inventory updates
- [ ] User changes

---

## 📝 Common Tasks

### Add a New Module
```bash
mkdir -p src/[feature]/{controllers,services,entities,dto}
# Create files:
# - controllers/[feature].controller.ts
# - services/[feature].service.ts
# - entities/[feature].entity.ts
# - dto/create-[feature].dto.ts
# - dto/update-[feature].dto.ts
# - [feature].module.ts
```

### Add Error Handling
Use global `HttpExceptionFilter`:
```typescript
throw new BadRequestException('Invalid input');
```

### Add Pagination
Use `PaginationDto` and `paginate()` util:
```typescript
const result = paginate(items, page, limit, total);
```

### Send Notifications
```typescript
constructor(private emailService: EmailService) {}

await this.emailService.sendOrderConfirmation(email, orderNumber);
```

---

## 🔐 Key Points

✅ **DO:**
- Keep modules independent
- Use dependency injection
- Validate all input DTOs
- Use database transactions for multi-step operations
- Log important actions

❌ **DON'T:**
- Import from deeply nested paths
- Mix concerns in services
- Skip validation
- Ignore error handling
- Directly access database from controllers

---

## 📚 Files Template Created

- ✅ `common/filters/http-exception.filter.ts`
- ✅ `common/interceptors/transform.interceptor.ts`
- ✅ `common/dto/pagination.dto.ts`
- ✅ `common/utils/pagination.util.ts`
- ✅ `common/constants/app.constants.ts`
- ✅ `config/env.schema.ts`
- ✅ `products/entities/product.entity.ts`
- ✅ `orders/entities/order.entity.ts`
- ✅ `orders/entities/order-item.entity.ts`
- ✅ `warehouse/entities/warehouse.entity.ts`
- ✅ `inventory/entities/inventory.entity.ts`
- ✅ `notifications/services/email.service.ts`
- ✅ `notifications/services/sms.service.ts`
- ✅ `notifications/services/push.service.ts`

---

## 🎯 Next Steps

1. **Update `app.module.ts`** - Import all feature modules
2. **Set up database** - Create migrations in `database/migrations/`
3. **Implement modules** - Start with users, products, orders
4. **Add authentication** - Set up auth guards and JWT strategy
5. **Wire notifications** - Connect to email/SMS providers
6. **Setup audit logs** - Track all changes

---

## 📖 Resources

- [NestJS Documentation](https://docs.nestjs.com)
- [Class Validator](https://github.com/typestack/class-validator)
- [TypeORM](https://typeorm.io) (if using ORM)
