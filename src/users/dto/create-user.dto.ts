import { IsEmail, IsString, MinLength, IsPhoneNumber, IsOptional, IsEnum } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(3)
  name!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  @IsEnum(['admin', 'shop_manager', 'user'])
  role!: 'admin' | 'shop_manager' | 'user';

  @IsOptional()
  shopId?: string;
}
