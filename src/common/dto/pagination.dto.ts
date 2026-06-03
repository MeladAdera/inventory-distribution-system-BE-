import { IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number;

  constructor(page: number = 1, limit: number = 10) {
    this.page = page || 1;
    this.limit = limit || 10;
  }

  get offset(): number {
    return (this.page - 1) * this.limit;
  }
}
