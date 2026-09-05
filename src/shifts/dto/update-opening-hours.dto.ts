import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

/**
 * Wall-clock time of day: `HH:MM` or `HH:MM:SS`, 00:00 through 23:59, plus the
 * single extra literal `24:00` meaning the end of the day.
 *
 * Postgres `TIME` accepts `'24:00:00'`, and a shop trading "until midnight"
 * needs it: `00:00` would be read as the *start* of the day and make the
 * window empty. The alternation spells the exception out rather than widening
 * the hour range, which would also let `24:30` through.
 */
export const TIME_PATTERN = /^(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?|24:00(?::00)?)$/;

export class OpeningHourDto {
  @ApiProperty({ example: 1, minimum: 0, maximum: 6, description: '0 = Sunday, matching JavaScript getDay()' })
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(0, { message: i18nValidationMessage('validation.MIN') })
  @Max(6, { message: i18nValidationMessage('validation.MAX') })
  weekday!: number;

  @ApiProperty({ example: '08:00', description: 'Wall-clock time in the shop timezone' })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(TIME_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  openTime!: string;

  @ApiProperty({
    example: '24:00',
    description: 'Earlier than openTime means the day runs past midnight. 24:00 means end of day.',
  })
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(TIME_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  closeTime!: string;

  @ApiPropertyOptional({ example: false, description: 'Shop does not open this day. Times are kept but ignored.' })
  @IsOptional()
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  isClosed?: boolean;
}

export class UpdateOpeningHoursDto {
  /**
   * All seven days, every time. A trading week is one thing the owner edits
   * and saves, and accepting a partial list would let the stored week and the
   * grid on screen drift apart with no way to tell which is right.
   */
  @ApiProperty({ type: [OpeningHourDto], minItems: 7, maxItems: 7, description: 'All 7 days, one per weekday 0..6' })
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ArrayMinSize(7, { message: i18nValidationMessage('validation.ARRAY_MIN_SIZE') })
  @ArrayMaxSize(7, { message: i18nValidationMessage('validation.ARRAY_MAX_SIZE') })
  @ValidateNested({ each: true })
  @Type(() => OpeningHourDto)
  days!: OpeningHourDto[];

  /**
   * IANA zone name. Optional: omitting it leaves the shop's current zone
   * alone, so saving hours never changes the zone by accident.
   */
  @ApiPropertyOptional({ example: 'Asia/Damascus', description: 'IANA timezone. Omit to leave unchanged.' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(64, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  timezone?: string;
}
