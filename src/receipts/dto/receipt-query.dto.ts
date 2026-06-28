import { IsOptional, IsInt, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ReceiptQueryDto extends PaginationDto {
  @ApiProperty({ example: 2, required: false, description: 'Admin only — filter by shop' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shopId?: number;

  @ApiProperty({ example: 5, required: false, description: 'Filter by user who created the receipt' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  createdBy?: number;

  @ApiProperty({ example: '2026-06-01', required: false })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiProperty({ example: '2026-06-30', required: false })
  @IsOptional()
  @IsString()
  toDate?: string;
}
