import { IsInt, NotEquals, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

export class AdjustInventoryDto {
  @ApiProperty({ example: -5, description: 'Positive to add, negative to remove' })
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @NotEquals(0, { message: i18nValidationMessage('validation.NOT_EQUALS') })
  adjustment!: number;

  @ApiProperty({ example: 'Damaged items', required: false })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  reason?: string;
}
