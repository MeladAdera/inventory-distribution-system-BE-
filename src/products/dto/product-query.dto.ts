import { IsOptional, IsEnum, IsBoolean, IsString, IsInt } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

export enum ProductSource {
  WAREHOUSE = 'WAREHOUSE',
  LOCAL = 'LOCAL',
}

export enum StockStatus {
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  LOW_STOCK = 'LOW_STOCK',
  HIGH_STOCK = 'HIGH_STOCK',
}

export class ProductQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Search by product name or barcode (case-insensitive)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ProductSource })
  @IsOptional()
  @IsEnum(ProductSource)
  source?: ProductSource;

  @ApiPropertyOptional({ description: 'Filter by category name (case-insensitive)' })
  @IsOptional()
  @IsString()
  category_name?: string;

  @ApiPropertyOptional({ description: 'WAREHOUSE_ADMIN only — filter by a specific shop' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shop_id?: number;

  @ApiPropertyOptional({ description: 'WAREHOUSE_ADMIN only — filter by shop name (case-insensitive partial match)' })
  @IsOptional()
  @IsString()
  shop_name?: string;

  @ApiPropertyOptional({ description: 'WAREHOUSE_ADMIN only — false to show inactive products; defaults to active only' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value as boolean;
  })
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ enum: StockStatus, description: 'Filter by stock level relative to inventory threshold' })
  @IsOptional()
  @IsEnum(StockStatus)
  stock_status?: StockStatus;
}
