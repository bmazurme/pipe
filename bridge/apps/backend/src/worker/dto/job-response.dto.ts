import { Job, JobModel, JobStatus } from '../entities/job.entity';

export class JobResponseDto {
  id: number;
  sourceFileId: number | null;
  resultFileId: number | null;
  model: JobModel;
  claudeCredentialId: number | null;
  status: JobStatus;
  logs: string;
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
