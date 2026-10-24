import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { encryptedColumn } from '../../crypto/encrypted-column.transformer';
import type { ClaudeRunUsage } from '../claude-limits';

// Sonnet/opus/haiku run through the existing `claude` CLI (same as sync's
// agent-runner); gpt/deepseek/qwen run through worker's own minimal
// OpenAI-compatible tool-calling loop, since all three expose the same
// Chat Completions + function-calling shape.
export enum JobModel {
  Sonnet = 'sonnet',
  Opus = 'opus',
  Haiku = 'haiku',
  Gpt = 'gpt',
  Deepseek = 'deepseek',
  Qwen = 'qwen',
}

// The models that run through the `claude` CLI, and so use a stored Claude token and report plan limits.
export const CLAUDE_JOB_MODELS: readonly JobModel[] = [
  JobModel.Sonnet,
  JobModel.Opus,
  JobModel.Haiku,
];

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
@Index(['userId', 'taskKey'])
@Index(['sourceFileId'])
// Serves the Worker page's delta poll (`updatedAfter`, see WorkerService.findAllByUser). Named
// explicitly so migration:check matches the name the migration creates.
@Index('IDX_jobs_userId_updatedAt', ['userId', 'updatedAt'])
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

  // An RSA public key (PEM, not a secret): when set, the worker encrypts the result parcel with it before uploading
  // (hybrid RSA+AES, `.enc`), so only the holder of the private key can open it. Null = the result is stored as is.
  @Column({ type: 'text', nullable: true })
  resultPublicKey: string | null;

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

  // The stored token the run actually used, set at claim. claudeCredentialId is only what the user pinned (retry()
  // copies that); this also covers the worker's / the account's first token it fell back to. The name is a snapshot.
  @Column({ type: 'int', unsigned: true, nullable: true })
  usedClaudeCredentialId: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  usedClaudeCredentialName: string | null;

  // Tokens and cost of the Claude run, as the worker reported them (claude-limits.ts); null for other models.
  @Column({ type: 'jsonb', nullable: true })
  usage: ClaudeRunUsage | null;

  // Which stored API key (ProviderCredential) a gpt/deepseek/qwen job runs with; null = the account's first one for that
  // provider. ON DELETE SET NULL in the migration, like claudeCredentialId.
  @Column({ type: 'int', unsigned: true, nullable: true })
  providerCredentialId: number | null;

  // The worker that claimed this job (null for a legacy worker that authenticates with a personal API key, and
  // after that worker is deleted) — and, when the owner pinned the job to one worker at launch, which one may take it.
  // Null target = any free worker.
  @Column({ type: 'int', unsigned: true, nullable: true })
  workerId: number | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  targetWorkerId: number | null;

  // A capability a worker must have to take this job (see capabilities.ts); null = any worker.
  @Column({ type: 'varchar', length: 32, nullable: true })
  requiredCapability: string | null;

  // The context the owner attached at launch (see ContextModule) — a snapshot, not a
  // reference, so editing or deleting the saved context never changes a job that is
  // queued or already ran. Both null (the default) when nothing was attached. The text
  // is only ever handed to the worker at claim time; human-facing routes see the name.
  @Column({ type: 'varchar', length: 100, nullable: true })
  contextName: string | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedColumn })
  contextText: string | null;

  // Which task this job works on — the parcel's taskKey, or `file:<id>` for a plain file —
  // copied at creation. A succeeded pipeline job loses its sourceFileId (the parcel is
  // consumed), so this is what still ties its outcome to the next run on the same task.
  @Column({ type: 'varchar', length: 255, nullable: true })
  taskKey: string | null;

  // Outcomes of earlier runs of this task, when the owner asked for them at launch: a
  // snapshot built at creation (see run-history.ts), like the context. Null when not
  // asked for, or when there was nothing earlier. Like contextText, only the worker gets it.
  @Column({ type: 'text', nullable: true, transformer: encryptedColumn })
  historyText: string | null;

  @Column({ type: 'smallint', nullable: true })
  historyCount: number | null;

  // The run's time limit in seconds, chosen at launch; null = the worker's own jobTimeoutSec applies.
  @Column({ type: 'int', nullable: true })
  timeoutSec: number | null;

  // Seconds the owner added to the limit while the job runs; null = never extended.
  @Column({ type: 'int', nullable: true })
  extraTimeoutSec: number | null;

  // Opt-in Telegram message when the job ends (honoured for the deployment owner only).
  @Column({ type: 'boolean', default: false })
  notifyOnFinish: boolean;

  // A queued job is not handed to a worker before this moment (null = right away).
  @Column({ type: 'timestamptz', nullable: true })
  notBefore: Date | null;

  @Column({ type: 'enum', enum: JobStatus, default: JobStatus.Queued })
  status: JobStatus;

  // Append-only; while a job runs the frontend polls only what was appended
  // since its last poll (GET :id?logsFrom=, see WorkerService.findOwnedWithLogsFrom).
  @Column({ type: 'text', default: '' })
  logs: string;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  // Why a failed job failed when the cause is the worker process rather than the
  // task: 'shutdown' (worker reported SIGTERM) or 'lost' (sweep). Null otherwise.
  @Column({ type: 'varchar', length: 16, nullable: true })
  failureKind: 'shutdown' | 'lost' | null;

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
