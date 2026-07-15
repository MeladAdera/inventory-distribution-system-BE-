import { IsOptional, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class NotificationQueryDto extends PaginationDto {
  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @Transform(({ value }: { value: string }) => value === 'true')
  @IsBoolean({ message: i18nValidationMessage('validation.IS_BOOLEAN') })
  isRead?: boolean;
}
