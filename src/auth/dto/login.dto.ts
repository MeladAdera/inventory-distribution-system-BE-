import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@warehouse.com' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  email!: string;

  @ApiProperty({ example: 'Admin@123' })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password!: string;
}
