import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

import { MaxFutureDate, MinFutureDate } from './not-before.validators';

export class RetryJobDto {
  // Do not start the new job before this time (a future moment, at most 7 days ahead).
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinFutureDate()
  @MaxFutureDate(7 * 24 * 60 * 60 * 1000)
  notBefore?: Date;
}
