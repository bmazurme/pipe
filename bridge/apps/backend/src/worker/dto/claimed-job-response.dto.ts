import { Job } from '../entities/job.entity';
import { JobResponseDto } from './job-response.dto';

// Used only by WorkerController.claim — the one route that hands the
// worker process an actual Claude credential value, never exposed through
// the human-facing job routes (JobResponseDto only ever carries the
// credential's id, never its token).
export class ClaimedJobResponseDto extends JobResponseDto {
  claudeToken: string | null;

  static fromEntityWithToken(
    job: Job,
    claudeToken: string | null,
  ): ClaimedJobResponseDto {
    return { ...JobResponseDto.fromEntity(job), claudeToken };
  }
}
