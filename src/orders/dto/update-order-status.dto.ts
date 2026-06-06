import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '../entities/order.entity';

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'SHIPPED', 'RECEIVED', 'COMPLETED'] })
  @IsEnum(['PENDING', 'PROCESSING', 'SHIPPED', 'RECEIVED', 'COMPLETED'])
  status!: OrderStatus;
}
