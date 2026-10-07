import { IsBoolean, IsOptional } from 'class-validator';

export class CancelJobDto {
  // Stop the job on bridge right now, without waiting for the worker to confirm —
  // for a worker that is gone (crashed, offline) and would never answer.
  @IsBoolean()
  @IsOptional()
  force?: boolean;
}
