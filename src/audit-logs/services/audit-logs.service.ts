import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import * as pg from 'pg';
import { AuditLogsRepository, CreateAuditLogData } from '../repositories/audit-logs.repository';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditLogQueryDto } from '../dto/audit-log-query.dto';
import { UserRole } from '../../common/enums/user-role.enum';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';

export interface RequestUser {
  id: number;
  role: UserRole;
  shopId: number | null;
}

@Injectable()
export class AuditLogsService {
  constructor(private readonly auditLogsRepo: AuditLogsRepository) {}

  log(data: CreateAuditLogData, client?: pg.PoolClient): Promise<AuditLog> {
    return this.auditLogsRepo.insert(data, client);
  }

  async findAll(query: AuditLogQueryDto, user: RequestUser): Promise<PaginatedResponse<AuditLog>> {
    const scopedShopId = user.role === UserRole.WAREHOUSE_ADMIN ? undefined : user.shopId!;
    const result = await this.auditLogsRepo.findPaginated(query, scopedShopId);
    return paginate(result.data, query.page, query.limit, result.total);
  }

  async findById(id: number, user: RequestUser): Promise<AuditLog> {
    const log = await this.auditLogsRepo.findById(id);
    if (!log) throw new NotFoundException('Audit log not found');

    if (user.role !== UserRole.WAREHOUSE_ADMIN && log.shop_id !== user.shopId) {
      throw new ForbiddenException('You do not have access to this audit log');
    }

    return log;
  }
}
