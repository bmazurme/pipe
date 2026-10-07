import { IsIn, IsOptional, IsString } from 'class-validator';

import { JobStatus } from '../entities/job.entity';

// Worker only ever moves a job forward through 'running' -> 'succeeded',
// 'failed' or (after the owner asked it to stop) 'cancelled' via this endpoint
// — 'queued'/'claimed' are set by the service itself (create() and claim()),
// never accepted here.
export class UpdateJobStatusDto {
  @IsIn([
    JobStatus.Running,
    JobStatus.Succeeded,
    JobStatus.Failed,
    JobStatus.Cancelled,
  ])
  status:
    | JobStatus.Running
    | JobStatus.Succeeded
    | JobStatus.Failed
    | JobStatus.Cancelled;

  @IsString()
  @IsOptional()
  errorMessage?: string;
}
