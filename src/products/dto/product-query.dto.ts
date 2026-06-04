import { IsOptional, IsEnum, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

export enum ProductSource {
  WAREHOUSE = 'WAREHOUSE',
  LOCAL = 'LOCAL',
}

export class ProductQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ProductSource })
  @IsOptional()
  @IsEnum(ProductSource)
  source?: ProductSource;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  category_id?: number;

  @ApiPropertyOptional({ description: 'WAREHOUSE_ADMIN only — filter by a specific shop' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shop_id?: number;
}
