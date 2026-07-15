import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { UserRole } from '../../common/enums/user-role.enum';

export class UserQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: UserRole, description: 'Filter by role' })
  @IsOptional()
  @IsEnum(UserRole, { message: i18nValidationMessage('validation.IS_ENUM') })
  role?: UserRole;

  @ApiPropertyOptional({ example: 1, description: 'Filter by shop ID (WAREHOUSE_ADMIN only)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  shop_id?: number;

  @ApiPropertyOptional({ example: 'ahmed', description: 'Search by name or email (case-insensitive)' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  search?: string;
}
