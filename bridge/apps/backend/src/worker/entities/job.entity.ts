import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { encryptedColumn } from '../../crypto/encrypted-column.transformer';

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
  // Stopped on the owner's request (see WorkerService.cancel) — terminal, like
  // succeeded/failed, but never produces a result.
  Cancelled = 'cancelled',
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
  // Null once the job has succeeded and a pipeline parcel (one carrying a
  // taskKey) was consumed — see WorkerService.setResult.
  @Column({ type: 'int', unsigned: true, nullable: true })
  sourceFileId: number | null;

  // The result parcel's StoredFile.id, set once the job succeeds.
  @Column({ type: 'int', unsigned: true, nullable: true })
  resultFileId: number | null;

  @Column({ type: 'enum', enum: JobModel })
  model: JobModel;

  // Which named Claude credential (see ClaudeCredential) this job's run
  // authenticates with, for sonnet/opus — null when none was picked (gpt/
  // deepseek/qwen never set this; worker falls back to its own inherited
  // CLAUDE_CODE_OAUTH_TOKEN env var either way). ON DELETE SET NULL in the
  // migration — a deleted credential un-sets this rather than blocking the
  // delete or orphaning the FK.
  @Column({ type: 'int', unsigned: true, nullable: true })
  claudeCredentialId: number | null;

  // The context the owner attached at launch (see ContextModule) — a snapshot, not a
  // reference, so editing or deleting the saved context never changes a job that is
  // queued or already ran. Both null (the default) when nothing was attached. The text
  // is only ever handed to the worker at claim time; human-facing routes see the name.
  @Column({ type: 'varchar', length: 100, nullable: true })
  contextName: string | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedColumn })
  contextText: string | null;

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

  // Set when the owner asks to stop a job a worker already holds. The worker polls
  // for it, kills its run and confirms with status 'cancelled'; until then the job
  // reads "stopping". A job that was only queued is cancelled outright instead.
  @Column({ type: 'timestamp', nullable: true })
  cancelRequestedAt: Date | null;
}
