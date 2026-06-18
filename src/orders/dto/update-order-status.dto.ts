import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '../entities/order.entity';

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'SHIPPED', 'RECEIVED', 'COMPLETED', 'CANCELLED'] })
  @IsEnum(['PENDING', 'PROCESSING', 'SHIPPED', 'RECEIVED', 'COMPLETED', 'CANCELLED'])
  status!: OrderStatus;
}
