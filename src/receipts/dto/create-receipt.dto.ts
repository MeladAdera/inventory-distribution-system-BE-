import { IsArray, IsInt, IsOptional, IsPositive, IsString, MaxLength, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ReceiptItemDto {
  @ApiProperty({ example: 7, description: 'Inventory row ID' })
  @IsInt()
  @IsPositive()
  inventoryId!: number;

  @ApiProperty({ example: 5, description: 'Units consumed — must be positive' })
  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class CreateReceiptDto {
  @ApiProperty({ type: [ReceiptItemDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items!: ReceiptItemDto[];

  @ApiProperty({ example: 'End of day stock count', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
