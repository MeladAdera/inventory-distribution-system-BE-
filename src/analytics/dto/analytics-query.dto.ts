import { IsOptional, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
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
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 5;
}

export class ConsumptionTrendQueryDto {
  @ApiPropertyOptional({ enum: TrendPeriod, default: TrendPeriod.DAILY })
  @IsOptional()
  @IsEnum(TrendPeriod)
  period?: TrendPeriod = TrendPeriod.DAILY;
}

export class ShopConsumptionQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: TrendPeriod, default: TrendPeriod.DAILY })
  @IsOptional()
  @IsEnum(TrendPeriod)
  period?: TrendPeriod = TrendPeriod.DAILY;

  @ApiPropertyOptional({ description: 'Required for WAREHOUSE_ADMIN — which shop to inspect. Ignored for SHOP_OWNER / EMPLOYEE (uses their own shop).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shopId?: number;
}

export class ProductsByShopQueryDto {
  @ApiPropertyOptional({ enum: TrendPeriod, default: TrendPeriod.DAILY })
  @IsOptional()
  @IsEnum(TrendPeriod)
  period?: TrendPeriod = TrendPeriod.DAILY;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Filter to a single shop by ID. Omit for all shops.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shopId?: number;
}
