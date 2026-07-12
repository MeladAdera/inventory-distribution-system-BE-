import { IsEnum, IsInt, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { OrderStatus } from '../entities/order.entity';

export class OrderQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'PROCESSING', 'SHIPPED', 'RECEIVED', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsEnum(['PENDING', 'PROCESSING', 'SHIPPED', 'RECEIVED', 'COMPLETED', 'CANCELLED'])
  status?: OrderStatus;

  @ApiPropertyOptional({ description: 'WAREHOUSE_ADMIN only — filter by destination shop (to_shop_id)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shop_id?: number;
}
