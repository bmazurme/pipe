import { Job } from '../entities/job.entity';
import { JobResponseDto } from './job-response.dto';
import { ClaimedProviderDto } from './provider-credential-response.dto';

// Used only by WorkerController.claim — the one route that hands the
// worker process an actual Claude credential value, never exposed through
// the human-facing job routes (JobResponseDto only ever carries the
// credential's id, never its token). The attached context's text travels the
// same way: only here, never in the human-facing responses.
export class ClaimedJobResponseDto extends JobResponseDto {
  claudeToken: string | null;
  // The API key (and optional endpoint/model) for a gpt/deepseek/qwen job, resolved from the account's stored keys;
  // null when there is none (the worker then falls back to its own environment, as before).
  provider: ClaimedProviderDto | null;
  context: string | null;
  history: string | null;

  static fromEntityWithToken(
    job: Job,
    claudeToken: string | null,
    provider: ClaimedProviderDto | null = null,
  ): ClaimedJobResponseDto {
    return {
      ...JobResponseDto.fromEntity(job),
      claudeToken,
      provider,
      context: job.contextText ?? null,
      history: job.historyText ?? null,
    };
  }
}
