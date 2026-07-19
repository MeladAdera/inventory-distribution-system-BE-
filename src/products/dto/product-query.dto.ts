import { IsOptional, IsEnum, IsBoolean, IsString, IsInt } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaginationDto } from '../../common/dto/pagination.dto';

export enum ProductSource {
  WAREHOUSE = 'WAREHOUSE',
  LOCAL = 'LOCAL',
}

export enum StockStatus {
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  LOW_STOCK = 'LOW_STOCK',
  HIGH_STOCK = 'HIGH_STOCK',
  IN_STOCK = 'IN_STOCK',
}

export class ProductQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Search by product name or barcode (case-insensitive)' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  search?: string;

  @ApiPropertyOptional({ enum: ProductSource })
  @IsOptional()
  @IsEnum(ProductSource, { message: i18nValidationMessage('validation.IS_ENUM') })
  source?: ProductSource;

  @ApiPropertyOptional({ description: 'Filter by category name (case-insensitive)' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  category_name?: string;

  @ApiPropertyOptional({ description: 'WAREHOUSE_ADMIN only — filter by a specific shop' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  shop_id?: number;

  @ApiPropertyOptional({ description: 'WAREHOUSE_ADMIN only — filter by shop name (case-insensitive partial match)' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  shop_name?: string;

  @ApiPropertyOptional({ description: 'WAREHOUSE_ADMIN only — false to show inactive products; defaults to active only' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value as boolean;
  })
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  is_active?: boolean;

  @ApiPropertyOptional({ enum: StockStatus, description: 'Filter by stock level relative to inventory threshold' })
  @IsOptional()
  @IsEnum(StockStatus, { message: i18nValidationMessage('validation.IS_ENUM') })
  stock_status?: StockStatus;

  @ApiPropertyOptional({ description: 'true → only products a shop can order from the warehouse; false → catalog-only templates' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value as boolean;
  })
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  is_orderable?: boolean;
}
