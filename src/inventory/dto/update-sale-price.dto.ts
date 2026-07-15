import { IsNumber, IsPositive, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

export class UpdateSalePriceDto {
  @ApiProperty({ example: 12.5, description: 'New per-shop selling price for this inventory item. Must be greater than 0.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: i18nValidationMessage('validation.IS_NUMBER') })
  @IsPositive({ message: i18nValidationMessage('validation.IS_POSITIVE') })
  @Max(99999999.99, { message: i18nValidationMessage('validation.MAX') })
  salePrice!: number;
}
