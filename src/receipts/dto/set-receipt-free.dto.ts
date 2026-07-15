import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

export class SetReceiptFreeDto {
  @ApiProperty({ example: true, description: 'Whether this receipt is free (excluded from shop revenue)' })
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  isFree!: boolean;
}
