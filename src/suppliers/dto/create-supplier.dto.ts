import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

export class CreateSupplierDto {
  @ApiProperty({ example: 'Big Center Distribution' })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(255, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name!: string;

  /** Unique per shop. Names are not unique — too many real businesses share one. */
  @ApiPropertyOptional({ example: '0999123456', description: 'Unique within the shop' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(20, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  phone?: string;

  @ApiPropertyOptional({ example: 'Delivers every Sunday, net 30 terms' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  note?: string;
}
