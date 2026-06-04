import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateShopOwnerDto {
  @ApiProperty({ example: 'MD Market' })
  @IsString()
  shopName!: string;

  @ApiPropertyOptional({ example: '123 Main St' })
  @IsOptional()
  @IsString()
  shopAddress?: string;

  @ApiProperty({ example: 'Ahmed' })
  @IsString()
  ownerName!: string;

  @ApiProperty({ example: 'owner@mdmarket.com' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  email!: string;

  @ApiProperty({ example: 'Password123' })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password!: string;
}
