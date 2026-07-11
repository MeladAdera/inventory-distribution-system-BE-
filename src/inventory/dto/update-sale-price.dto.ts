import { IsNumber, IsPositive, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSalePriceDto {
  @ApiProperty({ example: 12.5, description: 'New per-shop selling price for this inventory item. Must be greater than 0.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(99999999.99)
  salePrice!: number;
}
