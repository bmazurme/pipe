import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';

import { JobModel } from '../entities/job.entity';
import { MaxFutureDate, MinFutureDate } from './not-before.validators';

export class RetryJobDto {
  // Do not start the new job before this time (a future moment, at most 7 days ahead).
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinFutureDate()
  @MaxFutureDate(7 * 24 * 60 * 60 * 1000)
  notBefore?: Date;

  // Run on another model than the failed job; absent = the same one.
  @IsOptional()
  @IsEnum(JobModel)
  model?: JobModel;

  // Run on another stored token; absent = the job's own, when it still fits the model.
  @IsOptional()
  @IsInt()
  @Min(1)
  claudeCredentialId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  providerCredentialId?: number;

  // Attach this saved context instead of the failed job's own; absent = keep the job's.
  @IsOptional()
  @IsInt()
  @Min(1)
  contextId?: number;

  // Run without any context (the job's own is dropped); ignored when contextId is set.
  @IsOptional()
  @IsBoolean()
  withoutContext?: boolean;
}
