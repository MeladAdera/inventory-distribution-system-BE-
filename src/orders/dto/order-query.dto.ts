import { IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { OrderStatus } from '../entities/order.entity';

export class OrderQueryDto extends PaginationDto {
  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'SHIPPED', 'RECEIVED', 'COMPLETED'], required: false })
  @IsOptional()
  @IsEnum(['PENDING', 'PROCESSING', 'SHIPPED', 'RECEIVED', 'COMPLETED'])
  status?: OrderStatus;
}
