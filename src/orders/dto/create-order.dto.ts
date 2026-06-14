import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsPositive, ArrayNotEmpty, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrderItemDto {
  @ApiProperty({ example: 10 })
  @IsInt()
  @IsPositive()
  productId!: number;

  @ApiProperty({ example: 20 })
  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class CreateOrderDto {
  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @ApiPropertyOptional({ description: 'WAREHOUSE_ADMIN only — destination shop (to_shop_id). Required when called by an admin.' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  shopId?: number;
}
