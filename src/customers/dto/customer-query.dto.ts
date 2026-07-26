import { IsOptional, IsString, IsBoolean, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CustomerQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'ali', description: 'Matches name or phone, case-insensitive' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(255, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  search?: string;

  @ApiPropertyOptional({ example: true, description: 'Only customers who still owe money' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  hasDebt?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Include deactivated customers' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  includeInactive?: boolean;
}
