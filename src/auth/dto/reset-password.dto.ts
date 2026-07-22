import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class ResetPasswordDto {
  @ApiProperty({ example: 'admin@warehouse.com' })
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  email!: string;

  @ApiProperty({ example: '483920', description: '6-digit code sent by email' })
  @Matches(/^\d{6}$/, { message: i18nValidationMessage('validation.MATCHES') })
  code!: string;

  @ApiProperty({ example: 'NewPass@456', description: 'New password, at least 6 characters' })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MinLength(6, { message: i18nValidationMessage('validation.MIN_LENGTH') })
  newPassword!: string;
}
