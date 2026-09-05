import { IsInt, IsOptional, IsPositive, IsString, IsIn, MaxLength, Matches } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaymentMethod } from '../entities/debt-payment.entity';

export const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'TRANSFER', 'OTHER'];

/** Positive, at most 2 decimals — the exact shape DECIMAL(15,2) stores losslessly. */
export const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

export class CreateDebtPaymentDto {
  /**
   * A string, not a number: money stays out of JS floats end to end (see
   * `money.util.ts`). A JSON number is still accepted and stringified here, so
   * `50` and `"50.00"` both work — but a value that cannot round-trip cleanly
   * (`1e21`, more than 2 decimals) fails the pattern rather than being rounded.
   */
  @ApiProperty({ example: '50.00', description: 'Amount collected. Must be > 0 and <= the remaining balance.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value))
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(MONEY_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  amount!: string;

  /**
   * The shift whose drawer this cash moved through.
   *
   * How it is treated depends on which way the money went, and that is decided
   * by the endpoint, not here: a customer collection falls back to the shop's
   * open shift when omitted, while a supplier payment stays unattached unless
   * this names a shift, because the cash may have come from the safe.
   */
  @ApiPropertyOptional({ example: 4, description: "Shift whose drawer this cash moved through" })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @IsPositive({ message: i18nValidationMessage('validation.IS_POSITIVE') })
  shiftSessionId?: number;

  @ApiPropertyOptional({ example: 'CASH', enum: PAYMENT_METHODS, default: 'CASH' })
  @IsOptional()
  @IsIn(PAYMENT_METHODS, { message: i18nValidationMessage('validation.IS_ENUM') })
  method?: PaymentMethod;

  @ApiPropertyOptional({ example: 'Paid at delivery' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  note?: string;
}
