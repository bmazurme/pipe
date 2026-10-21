import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { WORKER_CAPABILITIES, type WorkerCapability } from '../capabilities';
import { JobModel } from '../entities/job.entity';
import { MaxFutureDate, MinFutureDate } from './not-before.validators';

export class CreateJobDto {
  @IsInt()
  sourceFileId: number;

  @IsEnum(JobModel)
  model: JobModel;

  @IsOptional()
  @IsInt()
  claudeCredentialId?: number;

  // gpt/deepseek/qwen: which stored API key to run with; absent = the account's first one for that provider.
  @IsOptional()
  @IsInt()
  providerCredentialId?: number;

  // Pin the job to one worker; absent = any free worker that can run the model.
  @IsOptional()
  @IsInt()
  targetWorkerId?: number;

  // Only a worker with this capability may take the job (e.g. 'fusion'); absent = any worker.
  @IsOptional()
  @IsIn(WORKER_CAPABILITIES)
  requiredCapability?: WorkerCapability;

  // A saved context (ContextModule) to attach; absent = run with none.
  @IsOptional()
  @IsInt()
  contextId?: number;

  // Mix in the outcomes of earlier runs of this same task. Independent of contextId:
  // either, both or neither. Off by default.
  @IsOptional()
  @IsBoolean()
  includeHistory?: boolean;

  // Do not start the job before this time (a future moment, at most 7 days ahead); absent = as soon as a worker is free.
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinFutureDate()
  @MaxFutureDate(7 * 24 * 60 * 60 * 1000)
  notBefore?: Date;

  // Send a Telegram message when the job ends. Off by default.
  @IsOptional()
  @IsBoolean()
  notifyOnFinish?: boolean;

  // Encrypt the result parcel for the owner: an RSA public key (PEM). Absent = the result is stored unencrypted.
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @Matches(/-----BEGIN [A-Z ]*PUBLIC KEY-----/, {
    message: 'resultPublicKey must be a PEM public key',
  })
  resultPublicKey?: string;
}
