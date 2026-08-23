import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaginationDto } from '../../common/dto/pagination.dto';

export const SHIFT_SESSION_STATUSES = ['OPEN', 'CLOSED'] as const;

export class ShiftSessionQueryDto extends PaginationDto {
  /**
   * Filtered on `business_date`, not `opened_at`: a shift that ran from 23:30
   * to 02:00 belongs to the day it started, and asking for "yesterday" should
   * return it whole rather than splitting it across two days.
   */
  @ApiPropertyOptional({ example: '2026-08-01', description: 'From business date (inclusive)' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: 'To business date (inclusive)' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  to?: string;

  @ApiPropertyOptional({ example: 22, description: 'Only shifts worked by this employee' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  userId?: number;

  @ApiPropertyOptional({ enum: SHIFT_SESSION_STATUSES, description: 'OPEN or CLOSED' })
  @IsOptional()
  @IsIn(SHIFT_SESSION_STATUSES, { message: i18nValidationMessage('validation.IS_ENUM') })
  status?: (typeof SHIFT_SESSION_STATUSES)[number];
}

export class ShiftReportQueryDto {
  /** Declared so `?lang=` survives `forbidNonWhitelisted`; see PaginationDto. */
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  lang?: string;

  @ApiPropertyOptional({ example: '2026-08-01', description: 'From business date (inclusive)' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: 'To business date (inclusive)' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  to?: string;
}
