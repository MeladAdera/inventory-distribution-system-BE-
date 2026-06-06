import { Module } from '@nestjs/common';
import { AuditLogsService } from './services/audit-logs.service';
import { AuditLogsRepository } from './repositories/audit-logs.repository';
import { AuditLogsController } from './controllers/audit-logs.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [AuditLogsController],
  providers: [AuditLogsService, AuditLogsRepository],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
