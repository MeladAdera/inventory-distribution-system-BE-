import { IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

export class ReverseDebtPaymentDto {
  @ApiPropertyOptional({ example: 'Entered twice by mistake', description: 'Why this payment is being reversed' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  reason?: string;

  /**
   * The shift handing the money back out — today's drawer, not the one that
   * took it in. Omit when it goes back to the safe rather than a till.
   */
  @ApiPropertyOptional({ example: 4, description: "Shift whose drawer the money is returned from" })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @IsPositive({ message: i18nValidationMessage('validation.IS_POSITIVE') })
  shiftSessionId?: number;
}
