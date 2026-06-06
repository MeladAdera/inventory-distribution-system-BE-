import { Type } from 'class-transformer';
import { IsArray, IsInt, IsPositive, ArrayNotEmpty, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}
