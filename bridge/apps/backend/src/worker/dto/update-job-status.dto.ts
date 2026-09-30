import { IsEnum, IsOptional, IsString } from 'class-validator';

import { JobStatus } from '../entities/job.entity';

// Worker only ever moves a job forward through 'running' -> 'succeeded' or
// 'failed' via this endpoint — 'queued'/'claimed' are set by the service
// itself (create() and claim()), never accepted here.
export class UpdateJobStatusDto {
  @IsEnum(JobStatus)
  status: JobStatus.Running | JobStatus.Succeeded | JobStatus.Failed;

  @IsString()
  @IsOptional()
  errorMessage?: string;
}
