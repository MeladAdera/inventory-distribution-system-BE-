import { IsOptional, IsBoolean, IsInt, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class InventoryQueryDto extends PaginationDto {
  @IsOptional()
  @Transform(({ value }: { value: string }) => value === 'true')
  @IsBoolean()
  lowStock?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId?: number;

  @ApiPropertyOptional({ description: 'WAREHOUSE_ADMIN only — filter by a specific shop' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shop_id?: number;
}
