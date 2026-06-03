import { Module } from '@nestjs/common';
import { AuditLogsService } from './services/audit-logs.service';
import { AuditLogsController } from './controllers/audit-logs.controller';

@Module({
  controllers: [AuditLogsController],
  providers: [AuditLogsService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
