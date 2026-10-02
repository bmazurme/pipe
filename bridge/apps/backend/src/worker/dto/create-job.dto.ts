import { IsEnum, IsInt, IsOptional } from 'class-validator';

import { JobModel } from '../entities/job.entity';

export class CreateJobDto {
  @IsInt()
  sourceFileId: number;

  @IsEnum(JobModel)
  model: JobModel;

  @IsOptional()
  @IsInt()
  claudeCredentialId?: number;
}
