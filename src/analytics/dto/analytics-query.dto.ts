import { IsOptional, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaginationDto } from '../../common/dto/pagination.dto';

export enum TrendPeriod {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export class TopProductsQueryDto {
  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  @Max(20, { message: i18nValidationMessage('validation.MAX') })
  limit?: number = 5;
}

export class ConsumptionTrendQueryDto {
  @ApiPropertyOptional({ enum: TrendPeriod, default: TrendPeriod.DAILY })
  @IsOptional()
  @IsEnum(TrendPeriod, { message: i18nValidationMessage('validation.IS_ENUM') })
  period?: TrendPeriod = TrendPeriod.DAILY;
}

export class ShopConsumptionQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: TrendPeriod, default: TrendPeriod.DAILY })
  @IsOptional()
  @IsEnum(TrendPeriod, { message: i18nValidationMessage('validation.IS_ENUM') })
  period?: TrendPeriod = TrendPeriod.DAILY;

  @ApiPropertyOptional({ description: 'Required for WAREHOUSE_ADMIN — which shop to inspect. Ignored for SHOP_OWNER / EMPLOYEE (uses their own shop).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  shopId?: number;
}

export class ProfitQueryDto {
  @ApiPropertyOptional({ enum: TrendPeriod, default: TrendPeriod.DAILY })
  @IsOptional()
  @IsEnum(TrendPeriod, { message: i18nValidationMessage('validation.IS_ENUM') })
  period?: TrendPeriod = TrendPeriod.DAILY;

  @ApiPropertyOptional({ description: 'WAREHOUSE_ADMIN only — view a specific shop\'s profit (from receipts). Omit for warehouse profit (from completed orders). Ignored for SHOP_OWNER (uses their own shop).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  shopId?: number;
}

export class ProductsByShopQueryDto {
  @ApiPropertyOptional({ enum: TrendPeriod, default: TrendPeriod.DAILY })
  @IsOptional()
  @IsEnum(TrendPeriod, { message: i18nValidationMessage('validation.IS_ENUM') })
  period?: TrendPeriod = TrendPeriod.DAILY;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  @Max(50, { message: i18nValidationMessage('validation.MAX') })
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Filter to a single shop by ID. Omit for all shops.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  shopId?: number;
}
