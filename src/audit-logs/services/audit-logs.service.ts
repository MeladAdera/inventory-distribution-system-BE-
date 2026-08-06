import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { I18nService, I18nContext } from 'nestjs-i18n';
import * as pg from 'pg';
import { AuditLogsRepository, CreateAuditLogData } from '../repositories/audit-logs.repository';
import { AuditLog, AuditLogDetail } from '../entities/audit-log.entity';
import { AuditLogQueryDto } from '../dto/audit-log-query.dto';
import { UserRole } from '../../common/enums/user-role.enum';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { renderAuditNote, serializeAuditNote } from '../utils/audit-note.util';

@Injectable()
export class AuditLogsService {
  constructor(
    private readonly auditLogsRepo: AuditLogsRepository,
    private readonly i18n: I18nService,
  ) {}

  log(data: CreateAuditLogData, client?: pg.PoolClient): Promise<AuditLog> {
    return this.auditLogsRepo.insert(
      { ...data, notes: serializeAuditNote(data.notes) },
      client,
    );
  }

  async findAll(query: AuditLogQueryDto, user: RequestUser): Promise<PaginatedResponse<AuditLog>> {
    const scopedShopId = user.role === UserRole.WAREHOUSE_ADMIN ? undefined : user.shopId!;
    const result = await this.auditLogsRepo.findPaginated(query, scopedShopId);
    const lang = this.currentLang();
    const data = result.data.map((log) => this.localize(log, lang));
    return paginate(data, query.page, query.limit, result.total);
  }

  async findById(id: number, user: RequestUser): Promise<AuditLogDetail> {
    const log = await this.auditLogsRepo.findById(id);
    if (!log) throw new NotFoundException('audit-logs.NOT_FOUND');

    if (user.role !== UserRole.WAREHOUSE_ADMIN && log.shop_id !== user.shopId) {
      throw new ForbiddenException('audit-logs.ACCESS_DENIED');
    }

    return this.localize(log, this.currentLang());
  }

  private currentLang(): string {
    return I18nContext.current()?.lang ?? 'en';
  }

  /** Adds the display labels and renders the note in the reader's language. */
  private localize<T extends AuditLog>(log: T, lang: string): T {
    return {
      ...log,
      type_label: this.label('TYPE', log.type, lang),
      action_label: this.label('ACTION', log.action, lang),
      entity_type_label: this.label('ENTITY', log.entity_type, lang),
      notes: renderAuditNote(log.notes, this.i18n, lang),
    };
  }

  /**
   * Falls back to the raw code when a translation is missing: these codes come
   * out of the database, so a row written by an older (or newer) version of the
   * app should still read as something, not as a bare i18n key.
   */
  private label(group: 'TYPE' | 'ACTION' | 'ENTITY', code: string | null, lang: string): string | null {
    if (!code) return null;
    const key: string = `audit-logs.${group}.${code}`;
    const translated = this.i18n.translate<string, string>(key, { lang });
    return translated === key ? code : translated;
  }
}
