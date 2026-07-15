import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

export class UpdateShopStatusDto {
  @ApiProperty()
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  isActive!: boolean;
}
