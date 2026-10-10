import { Job, JobModel, JobStatus } from '../entities/job.entity';

export class JobResponseDto {
  id: number;
  sourceFileId: number | null;
  resultFileId: number | null;
  model: JobModel;
  claudeCredentialId: number | null;
  // The attached context's name, or null — never its text (see ClaimedJobResponseDto).
  contextName: string | null;
  // How many earlier runs' outcomes were mixed in, or null when none were.
  historyCount: number | null;
  status: JobStatus;
  logs: string;
  // Only with ?logsFrom=N: then `logs` holds just the characters after the first N,
  // and this is the whole log's length in characters.
  logsLength?: number;
  errorMessage: string | null;
  workerName: string | null;
  claimedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  cancelRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(job: Job): JobResponseDto {
    return {
      id: job.id,
      sourceFileId: job.sourceFileId,
      resultFileId: job.resultFileId,
      model: job.model,
      claudeCredentialId: job.claudeCredentialId,
      contextName: job.contextName ?? null,
      historyCount: job.historyCount ?? null,
      status: job.status,
      // Undefined when the list query deliberately skipped the column.
      logs: job.logs ?? '',
      errorMessage: job.errorMessage,
      workerName: job.workerName,
      claimedAt: job.claimedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      cancelRequestedAt: job.cancelRequestedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
