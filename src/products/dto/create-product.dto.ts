import {
  IsString,
  IsOptional,
  IsNumber,
  IsPositive,
  IsInt,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ example: 'Mineral Water 500ml', minLength: 3, maxLength: 150 })
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({ example: 'Natural spring water, 500ml bottle' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '6281234567890' })
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiProperty({ example: 1.5, description: 'Selling price. Must be greater than 0' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price!: number;

  @ApiPropertyOptional({ example: 0.9, description: 'Buying price (cost). Used for profit tracking. Defaults to 0.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost_price?: number;

  @ApiProperty({ example: 3, description: 'Must reference an existing category accessible to this shop' })
  @Type(() => Number)
  @IsInt()
  category_id!: number;
}
