import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// Sonnet/opus run through the existing `claude` CLI (same as sync's
// agent-runner); gpt/deepseek/qwen run through worker's own minimal
// OpenAI-compatible tool-calling loop, since all three expose the same
// Chat Completions + function-calling shape.
export enum JobModel {
  Sonnet = 'sonnet',
  Opus = 'opus',
  Gpt = 'gpt',
  Deepseek = 'deepseek',
  Qwen = 'qwen',
}

export enum JobStatus {
  Queued = 'queued',
  Claimed = 'claimed',
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
}

@Entity({ name: 'jobs' })
@Index(['userId', 'status'])
export class Job extends BaseEntity {
  @Column({ type: 'int', unsigned: true, nullable: false })
  userId: number;

  // The input parcel — a StoredFile.id already sitting in this user's
  // storage. Worker only ever accepts unencrypted parcels (see
  // WorkerService.create): the private key needed to decrypt a `.enc`
  // parcel never leaves the account owner's own machines today, and
  // handing it to a shared, bridge-hosted process is out of scope.
  @Column({ type: 'int', unsigned: true, nullable: false })
  sourceFileId: number;

  // The result parcel's StoredFile.id, set once the job succeeds.
  @Column({ type: 'int', unsigned: true, nullable: true })
  resultFileId: number | null;

  @Column({ type: 'enum', enum: JobModel })
  model: JobModel;

  @Column({ type: 'enum', enum: JobStatus, default: JobStatus.Queued })
  status: JobStatus;

  // Append-only; the frontend polls the job and re-renders this in full —
  // adequate for the expected volume of a single coding-agent run.
  @Column({ type: 'text', default: '' })
  logs: string;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  // Self-reported hostname of whichever worker process claimed this job —
  // purely informational, helps distinguish jobs if more than one worker
  // instance is running against the same account.
  @Column({ type: 'varchar', length: 255, nullable: true })
  workerName: string | null;

  @Column({ type: 'timestamp', nullable: true })
  claimedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
