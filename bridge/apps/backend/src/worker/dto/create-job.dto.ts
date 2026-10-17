import { IsBoolean, IsEnum, IsInt, IsOptional } from 'class-validator';

import { JobModel } from '../entities/job.entity';

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

  // A saved context (ContextModule) to attach; absent = run with none.
  @IsOptional()
  @IsInt()
  contextId?: number;

  // Mix in the outcomes of earlier runs of this same task. Independent of contextId:
  // either, both or neither. Off by default.
  @IsOptional()
  @IsBoolean()
  includeHistory?: boolean;

  // Send a Telegram message when the job ends. Off by default.
  @IsOptional()
  @IsBoolean()
  notifyOnFinish?: boolean;
}
