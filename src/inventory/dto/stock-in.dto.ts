import { IsInt, IsPositive, IsOptional, IsString, MaxLength, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StockInDto {
  @ApiProperty({ example: 15 })
  @IsInt()
  @IsPositive()
  productId!: number;

  @ApiProperty({ example: 100 })
  @IsInt()
  @IsPositive()
  quantity!: number;

  // Unit cost of THIS incoming batch. Deliberately tri-state:
  //   - omitted   → inherit the current avg cost (or the product's cost_price
  //                 for a brand-new row); leaves the running average untouched.
  //   - 0         → genuinely free stock (samples/promo); lowers the basis.
  //   - > 0       → blended into the moving average.
  // No default is set, so an empty field stays `undefined` (omitted) and can
  // never silently collapse to 0 and tank the cost basis.
  @ApiPropertyOptional({
    example: 12.5,
    description:
      'Unit cost of this batch. Omit to inherit current avg cost; send 0 only for genuinely free stock.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(999999.9999)
  unitCost?: number;

  @ApiProperty({ example: 'Supplier delivery', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
