import { IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { CreateDebtPaymentDto } from './create-debt-payment.dto';

export class CreateCustomerPaymentDto extends CreateDebtPaymentDto {
  /**
   * Omit to settle the oldest debts first, which is how a shop actually works —
   * a customer hands over money for "what I owe", not for one receipt. Send it
   * when the customer is clearing one specific sale.
   */
  @ApiPropertyOptional({ example: 12, description: 'Pay one specific debt. Omit for oldest-first (FIFO).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  debtId?: number;
}
