import { Job } from '../entities/job.entity';
import { JobResponseDto } from './job-response.dto';

// Used only by WorkerController.claim — the one route that hands the
// worker process an actual Claude credential value, never exposed through
// the human-facing job routes (JobResponseDto only ever carries the
// credential's id, never its token). The attached context's text travels the
// same way: only here, never in the human-facing responses.
export class ClaimedJobResponseDto extends JobResponseDto {
  claudeToken: string | null;
  context: string | null;
  history: string | null;

  static fromEntityWithToken(
    job: Job,
    claudeToken: string | null,
  ): ClaimedJobResponseDto {
    return {
      ...JobResponseDto.fromEntity(job),
      claudeToken,
      context: job.contextText ?? null,
      history: job.historyText ?? null,
    };
  }
}
