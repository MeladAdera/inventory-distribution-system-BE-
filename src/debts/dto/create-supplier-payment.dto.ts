import { IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { CreateDebtPaymentDto } from './create-debt-payment.dto';

export class CreateSupplierPaymentDto extends CreateDebtPaymentDto {
  /**
   * Omit to settle the oldest bills first, which is how paying a supplier
   * actually works — you hand over money for "what we owe", not for one
   * particular invoice. Send it when you're clearing one specific bill.
   */
  @ApiPropertyOptional({ example: 24, description: 'Pay one specific bill. Omit for oldest-first (FIFO).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  debtId?: number;
}
