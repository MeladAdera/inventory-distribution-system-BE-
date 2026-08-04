import { IsOptional, IsInt, IsString, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { DebtStatus, DebtorType, AgingBucket, AGING_BUCKETS } from '../entities/debt.entity';

export const DEBT_STATUSES: DebtStatus[] = ['OPEN', 'PARTIAL', 'PAID', 'CANCELLED'];
export const DEBTOR_TYPES: DebtorType[] = ['SHOP', 'CUSTOMER'];

// Filters use @Type(() => Number) rather than ParseIntPipe on the query param:
// an omitted optional param must stay undefined, not blow up on parse.
export class DebtQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'OPEN', enum: DEBT_STATUSES })
  @IsOptional()
  @IsIn(DEBT_STATUSES, { message: i18nValidationMessage('validation.IS_ENUM') })
  status?: DebtStatus;

  @ApiPropertyOptional({ example: 'SHOP', enum: DEBTOR_TYPES })
  @IsOptional()
  @IsIn(DEBTOR_TYPES, { message: i18nValidationMessage('validation.IS_ENUM') })
  debtorType?: DebtorType;

  @ApiPropertyOptional({ example: 2, description: 'Admin only — the shop that owes' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  shopId?: number;

  @ApiPropertyOptional({ example: 7, description: 'Filter by the customer who owes' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  customerId?: number;

  @ApiPropertyOptional({ example: 3, description: 'Filter by the supplier who is owed' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  supplierId?: number;

  /**
   * The drill-down behind the aging report: which customers are actually in the
   * `60+` band. Uses the same age test the report groups by, and implies the
   * same "still owed" restriction, so the rows always add up to the bucket
   * total. Combining it with `status=PAID` or `CANCELLED` therefore returns
   * nothing — a settled debt is not aging.
   */
  @ApiPropertyOptional({ example: '60+', enum: AGING_BUCKETS, description: 'Filter by how long the debt has been owed' })
  @IsOptional()
  @IsIn(AGING_BUCKETS, { message: i18nValidationMessage('validation.IS_ENUM') })
  agingBucket?: AgingBucket;

  @ApiPropertyOptional({ example: '2026-06-01' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  fromDate?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  toDate?: string;
}
