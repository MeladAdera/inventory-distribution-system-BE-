import { IsInt, NotEquals, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustInventoryDto {
  @ApiProperty({ example: -5, description: 'Positive to add, negative to remove' })
  @IsInt()
  @NotEquals(0)
  adjustment!: number;

  @ApiProperty({ example: 'Damaged items', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
