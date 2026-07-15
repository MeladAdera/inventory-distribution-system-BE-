import {
  IsString,
  IsOptional,
  IsNumber,
  IsPositive,
  IsInt,
  IsBoolean,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

export class CreateProductDto {
  @ApiProperty({ example: 'Mineral Water 500ml', minLength: 3, maxLength: 150 })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MinLength(3, { message: i18nValidationMessage('validation.MIN_LENGTH') })
  @MaxLength(150, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name!: string;

  @ApiPropertyOptional({ example: 'Natural spring water, 500ml bottle' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  description?: string;

  @ApiPropertyOptional({ example: '6281234567890' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  barcode?: string;

  @ApiProperty({ example: 1.5, description: 'Selling price. Must be greater than 0' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: i18nValidationMessage('validation.IS_NUMBER') })
  @IsPositive({ message: i18nValidationMessage('validation.IS_POSITIVE') })
  price!: number;

  @ApiPropertyOptional({ example: 0.9, description: 'Buying price (cost). Used for profit tracking. Defaults to 0.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: i18nValidationMessage('validation.IS_NUMBER') })
  @Min(0, { message: i18nValidationMessage('validation.MIN') })
  cost_price?: number;

  @ApiProperty({ example: 3, description: 'Must reference an existing category accessible to this shop' })
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  category_id!: number;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description: 'Whether a shop can order this from the warehouse. Set false for a catalog-only template with no real warehouse stock.',
  })
  @IsOptional()
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  is_orderable?: boolean;
}
