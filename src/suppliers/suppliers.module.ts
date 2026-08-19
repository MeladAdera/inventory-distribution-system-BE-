import { Module } from '@nestjs/common';
import { SuppliersService } from './services/suppliers.service';
import { SuppliersController } from './controllers/suppliers.controller';
import { SuppliersRepository } from './repositories/suppliers.repository';
import { DebtsModule } from '../debts/debts.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  // InventoryModule for InventoryRepository: an invoice's goods are stocked
  // inside this module's transaction, so it talks to the repository directly
  // rather than to InventoryService, which opens a transaction of its own.
  // Same arrangement OrdersModule uses for delivery.
  imports: [DebtsModule, InventoryModule, AuditLogsModule],
  controllers: [SuppliersController],
  providers: [SuppliersService, SuppliersRepository],
  exports: [SuppliersRepository],
})
export class SuppliersModule {}
