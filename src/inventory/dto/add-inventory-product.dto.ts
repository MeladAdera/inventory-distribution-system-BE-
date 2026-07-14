import { IsInt, IsPositive, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddInventoryProductDto {
  @ApiProperty({ example: 4, description: 'Catalog product to register in this shop\'s inventory' })
  @IsInt()
  @IsPositive()
  productId!: number;

  // Optional opening balance. Defaults to 0 (register-only): the product just
  // lands on the shop's inventory list as out-of-stock, and restocking goes
  // through the orders flow. This is NOT a cost-bearing stock-in — avg_cost is
  // seeded from the product, never blended here. Ignored when the row already
  // exists (the add is idempotent).
  @ApiPropertyOptional({ example: 0, default: 0, description: 'Optional opening quantity; defaults to 0' })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;
}
