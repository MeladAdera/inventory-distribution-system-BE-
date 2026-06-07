import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { UserRole } from '../../common/enums/user-role.enum';

export class UserQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: UserRole, description: 'Filter by role' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ example: 1, description: 'Filter by shop ID (WAREHOUSE_ADMIN only)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shop_id?: number;

  @ApiPropertyOptional({ example: 'ahmed', description: 'Search by name or email (case-insensitive)' })
  @IsOptional()
  @IsString()
  search?: string;
}
