import { IsInt, IsPositive, IsOptional, IsString, MaxLength, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

export class StockInDto {
  @ApiProperty({ example: 15 })
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @IsPositive({ message: i18nValidationMessage('validation.IS_POSITIVE') })
  productId!: number;

  @ApiProperty({ example: 100 })
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @IsPositive({ message: i18nValidationMessage('validation.IS_POSITIVE') })
  quantity!: number;

  // Unit cost of THIS incoming batch. Deliberately tri-state:
  //   - omitted   → inherit the current avg cost (or the product's cost_price
  //                 for a brand-new row); leaves the running average untouched.
  //   - 0         → genuinely free stock (samples/promo); lowers the basis.
  //   - > 0       → blended into the moving average.
  // No default is set, so an empty field stays `undefined` (omitted) and can
  // never silently collapse to 0 and tank the cost basis.
  @ApiPropertyOptional({
    example: 12.5,
    description:
      'Unit cost of this batch. Omit to inherit current avg cost; send 0 only for genuinely free stock.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 }, { message: i18nValidationMessage('validation.IS_NUMBER') })
  @Min(0, { message: i18nValidationMessage('validation.MIN') })
  @Max(999999.9999, { message: i18nValidationMessage('validation.MAX') })
  unitCost?: number;

  @ApiProperty({ example: 'Supplier delivery', required: false })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  notes?: string;
}
