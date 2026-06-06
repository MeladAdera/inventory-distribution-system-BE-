import { IsInt, IsPositive, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StockInDto {
  @ApiProperty({ example: 15 })
  @IsInt()
  @IsPositive()
  productId!: number;

  @ApiProperty({ example: 100 })
  @IsInt()
  @IsPositive()
  quantity!: number;

  @ApiProperty({ example: 'Supplier delivery', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
