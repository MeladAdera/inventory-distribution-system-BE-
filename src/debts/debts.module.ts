import { Module } from '@nestjs/common';
import { DebtsService } from './services/debts.service';
import { DebtsController } from './controllers/debts.controller';
import { DebtsRepository } from './repositories/debts.repository';
import { DatabaseModule } from '../database/database.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ShiftsModule } from '../shifts/shifts.module';

/**
 * Owns the `/debts` routes, and exports `DebtsService` so the modules that own
 * a source document — orders, and later receipts — can raise and cancel debts
 * inside their own transactions.
 */
@Module({
  imports: [ShiftsModule, DatabaseModule, AuditLogsModule],
  controllers: [DebtsController],
  providers: [DebtsService, DebtsRepository],
  exports: [DebtsService],
})
export class DebtsModule {}
