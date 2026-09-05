import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { TIME_PATTERN } from './update-opening-hours.dto';

export class CreateShiftTemplateDto {
  @ApiProperty({ example: 1, minimum: 0, maximum: 6, description: '0 = Sunday, matching JavaScript getDay()' })
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(0, { message: i18nValidationMessage('validation.MIN') })
  @Max(6, { message: i18nValidationMessage('validation.MAX') })
  weekday!: number;

  @ApiProperty({ example: 'Morning' })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MinLength(1, { message: i18nValidationMessage('validation.MIN_LENGTH') })
  @MaxLength(80, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name!: string;

  @ApiProperty({ example: '08:00', description: 'Wall-clock time in the shop timezone' })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(TIME_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  startTime!: string;

  @ApiProperty({
    example: '16:00',
    description: 'Earlier than startTime means the shift runs past midnight. 24:00 means end of day.',
  })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(TIME_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  endTime!: string;
}

/**
 * `weekday` is deliberately absent. Moving a slot to another day would have to
 * give up its position in the old day and claim a free one in the new day,
 * against the new day's four-slot limit — a different operation wearing the
 * same name. Delete the slot and create it where it belongs instead.
 */
export class UpdateShiftTemplateDto {
  @ApiPropertyOptional({ example: 'Morning' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MinLength(1, { message: i18nValidationMessage('validation.MIN_LENGTH') })
  @MaxLength(80, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  name?: string;

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(TIME_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  startTime?: string;

  @ApiPropertyOptional({ example: '17:00' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(TIME_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  endTime?: string;
}
