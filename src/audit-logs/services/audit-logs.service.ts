import { Injectable } from '@nestjs/common';
import * as pg from 'pg';
import { AuditLogsRepository, CreateAuditLogData } from '../repositories/audit-logs.repository';
import { AuditLog } from '../entities/audit-log.entity';

@Injectable()
export class AuditLogsService {
  constructor(private readonly auditLogsRepo: AuditLogsRepository) {}

  log(data: CreateAuditLogData, client?: pg.PoolClient): Promise<AuditLog> {
    return this.auditLogsRepo.insert(data, client);
  }
}
