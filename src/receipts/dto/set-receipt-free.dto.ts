import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetReceiptFreeDto {
  @ApiProperty({ example: true, description: 'Whether this receipt is free (excluded from shop revenue)' })
  @IsBoolean()
  isFree!: boolean;
}
