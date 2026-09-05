import { ArrayMaxSize, IsArray, IsInt, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

export class AssignEmployeesDto {
  /**
   * The complete roster for this slot. Sending it whole rather than adding and
   * removing one name at a time matches how the owner edits it — a list in a
   * dialog, saved once — and leaves no way for the stored set and the list on
   * screen to disagree.
   *
   * An empty array is a valid save: it clears the slot.
   */
  @ApiProperty({
    type: [Number],
    example: [3, 7],
    description: 'Complete roster for this slot. Replaces the existing one. Empty clears it.',
  })
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  // A slot is worked by a rota, not a department. The cap is a guard against a
  // malformed request, not a business rule the owner will ever meet.
  @ArrayMaxSize(50, { message: i18nValidationMessage('validation.ARRAY_MAX_SIZE') })
  @Type(() => Number)
  @IsInt({ each: true, message: i18nValidationMessage('validation.IS_INT') })
  @IsPositive({ each: true, message: i18nValidationMessage('validation.IS_POSITIVE') })
  userIds!: number[];
}
