import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { JobStatus } from '../entities/job.entity';
import { MAX_ERROR_MESSAGE_LENGTH } from '../worker.limits';

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
  @MaxLength(MAX_ERROR_MESSAGE_LENGTH)
  @IsOptional()
  errorMessage?: string;
}
