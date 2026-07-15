import { IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { i18nValidationMessage } from 'nestjs-i18n';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  page: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: i18nValidationMessage('validation.IS_INT') })
  @Min(1, { message: i18nValidationMessage('validation.MIN') })
  limit: number;

  constructor(page: number = 1, limit: number = 10) {
    this.page = page || 1;
    this.limit = limit || 10;
  }

  get offset(): number {
    return (this.page - 1) * this.limit;
  }
}
