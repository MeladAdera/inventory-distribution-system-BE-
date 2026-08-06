import { IsOptional, IsInt, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { i18nValidationMessage } from 'nestjs-i18n';

export class PaginationDto {
  /**
   * Never read here — nestjs-i18n's QueryResolver picks `?lang` off the raw
   * request. It is declared only so the global pipe's `forbidNonWhitelisted`
   * stops rejecting it: without this, `?lang=ar` is a 400 on every endpoint
   * that takes a query DTO, and only the `Accept-Language` header works.
   */
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.IS_STRING') })
  lang?: string;

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
