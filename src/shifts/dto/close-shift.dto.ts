import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { MONEY_PATTERN } from '../../debts/dto/create-debt-payment.dto';

export class CloseShiftDto {
  /**
   * What the person actually counted in the drawer, by hand.
   *
   * The server never accepts what the till *should* hold — it works that out
   * itself and compares. A count supplied alongside an expected figure would
   * not be a count.
   */
  @ApiProperty({ example: '170.00', description: 'Cash counted in the drawer by hand' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value))
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(16, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  @Matches(MONEY_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  countedCash!: string;

  /** Somewhere to explain a difference while the reason is still fresh. */
  @ApiPropertyOptional({ example: 'Gave 5.00 change from my own pocket', description: 'Note on this close' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  notes?: string;
}
