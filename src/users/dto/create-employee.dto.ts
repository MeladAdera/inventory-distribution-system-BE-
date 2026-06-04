import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'john@mdmarket.com' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  email!: string;

  @ApiProperty({ example: 'Password123' })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password!: string;
}
