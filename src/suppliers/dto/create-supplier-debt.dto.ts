import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { MONEY_PATTERN } from '../../debts/dto/create-debt-payment.dto';

export class CreateSupplierDebtDto {
  /** A string, not a number — money stays out of JS floats end to end. */
  @ApiProperty({ example: '150.00', description: 'The full invoice total.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value))
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(MONEY_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  totalAmount!: string;

  /**
   * Defaults to `0` — a bill just entered as owed, nothing handed over yet.
   * Unlike a receipt's `paidAmount` (which defaults to the full total, since
   * most sales are paid in full), a supplier bill's whole purpose is usually
   * to record what's still owed, so the safer default is "nothing paid".
   */
  @ApiPropertyOptional({ example: '100.00', description: 'What was already paid. Defaults to 0. Must be <= totalAmount.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value))
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(MONEY_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  paidAmount?: string;

  @ApiPropertyOptional({ example: 'INV-882', description: "The supplier's own invoice/bill reference" })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(50, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  invoiceNo?: string;

  @ApiPropertyOptional({ example: 'Delivery 12 Aug' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  note?: string;
}
