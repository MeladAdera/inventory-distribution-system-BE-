import { IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

export class UpdateLowStockThresholdDto {
  // 0 is allowed: it means "only alert when completely out of stock".
  @ApiProperty({ example: 5, description: 'Per-shop minimum quantity. The item is low-stock when current_quantity <= this value. 0 = alert only at zero.' })
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(0, { message: i18nValidationMessage('validation.MIN') })
  @Max(1000000, { message: i18nValidationMessage('validation.MAX') })
  lowStockThreshold!: number;
}
