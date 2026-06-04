import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateShopStatusDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}
