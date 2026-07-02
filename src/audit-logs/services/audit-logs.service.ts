import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import * as pg from 'pg';
import { AuditLogsRepository, CreateAuditLogData } from '../repositories/audit-logs.repository';
import { AuditLog, AuditLogDetail } from '../entities/audit-log.entity';
import { AuditLogQueryDto } from '../dto/audit-log-query.dto';
import { UserRole } from '../../common/enums/user-role.enum';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';

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

  async findById(id: number, user: RequestUser): Promise<AuditLogDetail> {
    const log = await this.auditLogsRepo.findById(id);
    if (!log) throw new NotFoundException('audit-logs.NOT_FOUND');

    if (user.role !== UserRole.WAREHOUSE_ADMIN && log.shop_id !== user.shopId) {
      throw new ForbiddenException('audit-logs.ACCESS_DENIED');
    }

    return log;
  }
}
