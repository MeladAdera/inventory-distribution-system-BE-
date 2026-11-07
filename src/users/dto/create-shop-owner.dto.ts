import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class CreateShopOwnerDto {
  @ApiProperty({ example: 'Maple Street Market' })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  shopName!: string;

  @ApiPropertyOptional({ example: '123 Main St' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  shopAddress?: string;

  @ApiProperty({ example: 'Ahmed' })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  ownerName!: string;

  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail({}, { message: i18nValidationMessage('validation.IS_EMAIL') })
  email!: string;

  @ApiProperty({ example: 'Password123' })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MinLength(6, { message: i18nValidationMessage('validation.MIN_LENGTH') })
  password!: string;
}
