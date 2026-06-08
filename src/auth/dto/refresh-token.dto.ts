import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'The refresh token issued at login or last refresh',
    example: 'a3f1c2d4-...',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
