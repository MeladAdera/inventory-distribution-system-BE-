import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  name!: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  email!: string;

  @ApiProperty({ example: 'Password123' })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MinLength(6, { message: i18nValidationMessage('validation.MIN_LENGTH') })
  password!: string;
}
