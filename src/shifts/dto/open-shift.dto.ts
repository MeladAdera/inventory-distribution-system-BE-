import { IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { MONEY_PATTERN } from '../../debts/dto/create-debt-payment.dto';

export class OpenShiftDto {
  /**
   * The change already in the drawer at the start, so the close can tell a
   * float apart from takings. A string like every other money value here —
   * floats lose cents; see `src/common/utils/money.util.ts`.
   *
   * `MONEY_PATTERN` is unsigned, so a negative float is rejected as malformed
   * rather than needing a rule of its own. The length bound keeps a mistyped
   * run of digits from overflowing DECIMAL(15,2) into a database error.
   *
   * No `shiftTemplateId` here: the server resolves which slot is running from
   * the clock. It can, because templates on a weekday may not overlap, so at
   * most one window ever contains this moment.
   */
  @ApiProperty({ example: '50.00', description: 'Cash already in the drawer when the shift starts' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value))
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(16, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  @Matches(MONEY_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  openingFloat!: string;
}
