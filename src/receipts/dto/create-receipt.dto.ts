import { IsArray, IsInt, IsOptional, IsPositive, IsString, IsUUID, Matches, MaxLength, ValidateNested, ArrayMinSize } from 'class-validator';
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

  /**
   * An id the client generates once per sale and reuses on every retry. Send it
   * on every create, not only on replayed offline sales: a request that commits
   * but loses its response is retried by the same code path either way, and
   * without this id that retry rings the sale up twice.
   *
   * Sending the same id again returns the receipt from the first attempt
   * instead of creating a second one.
   */
  @ApiPropertyOptional({
    example: 'f0b0c1e2-3d4a-4b5c-8d9e-0f1a2b3c4d5e',
    description: 'Client-generated UUID. Resending the same one returns the original receipt instead of duplicating the sale.',
  })
  @IsOptional()
  @IsUUID(undefined, { message: i18nValidationMessage('validation.IS_UUID') })
  clientReceiptId?: string;

  /**
   * The shift this sale was rung up in. Omit and the server uses the shop's
   * currently open shift, which is what an online sale wants.
   *
   * Send it when replaying a sale made offline: by the time the queue drains,
   * that shift may have been closed and another opened, and resolving at
   * arrival time would file the money under the wrong drawer.
   */
  @ApiPropertyOptional({
    example: 4,
    description: "Shift this sale belongs to. Omit to use the shop's open shift; send it when replaying an offline sale.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @IsPositive({ message: i18nValidationMessage('validation.IS_POSITIVE') })
  shiftSessionId?: number;
}
