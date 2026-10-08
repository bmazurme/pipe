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

  // A saved context (ContextModule) to attach; absent = run with none.
  @IsOptional()
  @IsInt()
  contextId?: number;

  // Mix in the outcomes of earlier runs of this same task. Independent of contextId:
  // either, both or neither. Off by default.
  @IsOptional()
  @IsBoolean()
  includeHistory?: boolean;
}
