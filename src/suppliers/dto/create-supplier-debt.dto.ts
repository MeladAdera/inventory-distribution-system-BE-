import {
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  IsInt,
  IsPositive,
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';
import { MONEY_PATTERN } from '../../debts/dto/create-debt-payment.dto';

/**
 * One product line on the invoice. The product must already exist in the
 * catalog — creating it is a separate `POST /products` call, so that the name/
 * barcode/category rules live in exactly one place.
 */
export class SupplierDebtItemDto {
  @ApiProperty({ example: 15, description: 'Must already exist and be in this shop\'s scope' })
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @IsPositive({ message: i18nValidationMessage('validation.IS_POSITIVE') })
  productId!: number;

  @ApiProperty({ example: 50 })
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @IsPositive({ message: i18nValidationMessage('validation.IS_POSITIVE') })
  quantity!: number;

  /**
   * Required and strictly positive, unlike `StockInDto.unitCost` which is
   * deliberately tri-state and accepts an explicit 0. An invoice states its
   * prices by definition, an inherited cost could not be reconciled against
   * `totalAmount`, and a zero-cost line would pull the moving average down as
   * though the goods cost nothing. Genuinely free stock belongs in a stock
   * adjustment, not on a bill recording what was paid.
   *
   * The `> 0` rule is enforced in the service (for a translatable message) and
   * by `supplier_debt_items.unit_cost > 0` (the real guard).
   */
  @ApiProperty({ example: '12.00', description: 'Invoice unit price. Must be greater than 0.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value))
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(MONEY_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  unitCost!: string;
}

export class CreateSupplierDebtDto {
  /** A string, not a number — money stays out of JS floats end to end. */
  @ApiProperty({ example: '150.00', description: 'The full invoice total.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value))
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(MONEY_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  totalAmount!: string;

  /**
   * Defaults to `0` — a bill just entered as owed, nothing handed over yet.
   * Unlike a receipt's `paidAmount` (which defaults to the full total, since
   * most sales are paid in full), a supplier bill's whole purpose is usually
   * to record what's still owed, so the safer default is "nothing paid".
   */
  @ApiPropertyOptional({ example: '100.00', description: 'What was already paid. Defaults to 0. Must be <= totalAmount.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? value.toString() : value))
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @Matches(MONEY_PATTERN, { message: i18nValidationMessage('validation.MATCHES') })
  paidAmount?: string;

  @ApiPropertyOptional({ example: 'INV-882', description: "The supplier's own invoice/bill reference" })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(50, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  invoiceNo?: string;

  @ApiPropertyOptional({ example: 'Delivery 12 Aug' })
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  @MaxLength(500, { message: i18nValidationMessage('validation.MAX_LENGTH') })
  note?: string;

  /**
   * The goods on the invoice. Omit for a bill with no products behind it — a
   * service, a delivery charge, rent — which stays a plain payable.
   *
   * When present, every line is stocked into this shop's inventory at its
   * `unitCost`, and the lines must sum to exactly `totalAmount`: a bill whose
   * lines disagree with its own total means one of the two was mistyped, and
   * letting it through would leave the ledger and the cost basis permanently
   * out of step.
   */
  @ApiPropertyOptional({ type: [SupplierDebtItemDto], description: 'Goods bought. Must sum to totalAmount.' })
  @IsOptional()
  @IsArray({ message: i18nValidationMessage('validation.IS_ARRAY') })
  @ArrayNotEmpty({ message: i18nValidationMessage('validation.ARRAY_NOT_EMPTY') })
  @ArrayMaxSize(200, { message: i18nValidationMessage('validation.ARRAY_MAX_SIZE') })
  @ValidateNested({ each: true })
  @Type(() => SupplierDebtItemDto)
  items?: SupplierDebtItemDto[];
}
