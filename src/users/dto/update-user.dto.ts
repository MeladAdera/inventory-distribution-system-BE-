import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Ahmed Hassan' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ example: 'ahmed@mdmarket.com' })
  @IsOptional()
  @IsEmail({}, { message: 'Must be a valid email address' })
  email?: string;

  @ApiPropertyOptional({ example: 'Password123' })
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password?: string;
}
