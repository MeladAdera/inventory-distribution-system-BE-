import { IsArray, IsInt, IsOptional, IsPositive, IsString, Matches, MaxLength, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { MONEY_PATTERN } from '../../debts/dto/create-debt-payment.dto';

export class ReceiptItemDto {
  @ApiProperty({ example: 7, description: 'Inventory row ID' })
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @IsPositive({ message: i18nValidationMessage('validation.IS_POSITIVE') })
  inventoryId!: number;

  @ApiProperty({ example: 5, description: 'Units consumed — must be positive' })
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @IsPositive({ message: i18nValidationMessage('validation.IS_POSITIVE') })
  quantity!: number;
}

export class CreateReceiptDto {
  @ApiProperty({ type: [ReceiptItemDto], minItems: 1 })
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ArrayMinSize(1, { message: i18nValidationMessage('validation.ARRAY_MIN_SIZE') })
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items!: ReceiptItemDto[];

  @ApiProperty({ example: 'End of day stock count', required: false })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  notes?: string;

  /**
   * Only needed for a credit sale. A normal cash sale stays anonymous — no
   * customer row is created and none is required.
   */
  @ApiPropertyOptional({ example: 7, description: 'Required when paidAmount is less than the total' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @IsPositive({ message: i18nValidationMessage('validation.IS_POSITIVE') })
  customerId?: number;

  /**
   * Defaults to the full total, i.e. an ordinary paid-in-full sale. Anything
   * less opens a debt for the difference; `0` puts the whole sale on credit.
   * A string for the same reason as elsewhere — money never touches a float.
   */
  @ApiPropertyOptional({ example: '30.00', description: 'Defaults to the full total. Less than the total creates a debt.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value))
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(MONEY_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  paidAmount?: string;
}
