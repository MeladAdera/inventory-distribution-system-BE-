import { Module } from '@nestjs/common';
import { ReceiptsService } from './services/receipts.service';
import { ReceiptsController } from './controllers/receipts.controller';
import { ReceiptsRepository } from './repositories/receipts.repository';
import { DatabaseModule } from '../database/database.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [DatabaseModule, AuditLogsModule, NotificationsModule, InventoryModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService, ReceiptsRepository],
})
export class ReceiptsModule {}
