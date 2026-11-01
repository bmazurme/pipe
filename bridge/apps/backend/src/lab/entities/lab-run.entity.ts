import { Column, Entity, Index } from 'typeorm';

import type { LabExecutor } from '../lab-executor';
import { BaseEntity } from '../../base.entity';
import type { Routing } from '../../router/router-policy';

export enum LabRunStatus {
  // The row exists while bridge snapshots the repository and creates the job: a second start of the same task sees it.
  Preparing = 'preparing',
  // The worker job exists and has not finished (queued/claimed vs running).
  Queued = 'queued',
  Running = 'running',
  // The job succeeded; bridge is committing the result to a branch and opening the pull request.
  Publishing = 'publishing',
  PrOpen = 'pr_open',
  // Found out with "Проверить PR": the pull request was merged, or closed without merging, on GitHub.
  PrMerged = 'pr_merged',
  PrClosed = 'pr_closed',
  // The worker asked for a GitHub Issue (see ISSUE_MARKER_PATH in lab-publish.service.ts) instead of, or in
  // addition to, file changes; one was opened for this run, and there was nothing left worth a pull request.
  IssueOpen = 'issue_open',
  // The run finished but changed nothing worth a pull request.
  NoChanges = 'no_changes',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export const ACTIVE_LAB_RUN_STATUSES = [
  LabRunStatus.Preparing,
  LabRunStatus.Queued,
  LabRunStatus.Running,
  LabRunStatus.Publishing,
];

export type LabTrigger = 'manual' | 'schedule';

// One attempt: snapshot of the repository → worker job → branch + pull request.
@Entity({ name: 'lab_runs' })
@Index(['userId', 'status'])
@Index('IDX_lab_runs_status', ['status'])
@Index('IDX_lab_runs_userId_projectId_id', ['userId', 'projectId', 'id'])
export class LabRun extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  // Null once the project was disconnected: the run stays as history.
  @Column({ type: 'int', unsigned: true, nullable: true })
  projectId: number | null;

  // 'owner/name' at the time, so the history still says where it ran.
  @Column({ type: 'varchar', length: 200 })
  repo: string;

  @Column({ type: 'int', unsigned: true, nullable: true })
  scheduleId: number | null;

  @Column({ type: 'varchar', length: 16, default: 'manual' })
  trigger: LabTrigger;

  // A short name for lists and the pull request: the first line of the task, cut.
  @Column({ type: 'varchar', length: 255 })
  title: string;

  // The task as it was when the run started.
  @Column({ type: 'text' })
  task: string;

  // What was asked for: a model, or 'auto' — and then what the router made of it (routing) is the model the job really ran on.
  @Column({ type: 'varchar', length: 16 })
  model: string;

  // Set for an 'auto' run once the router has chosen: the model, and the reason in words (router-policy.ts `Routing`).
  @Column({ type: 'jsonb', nullable: true })
  routing: Routing | null;

  // Where it was asked to run: 'any' worker or a 'fusion' one (see lab-executor.ts).
  @Column({ type: 'varchar', length: 16, default: 'any' })
  executor: LabExecutor;

  @Column({ type: 'varchar', length: 24, default: LabRunStatus.Queued })
  status: LabRunStatus;

  @Column({ type: 'int', unsigned: true, nullable: true })
  jobId: number | null;

  // The branch the snapshot was taken from and the pull request targets. Null on runs from before it could be chosen: the project's.
  @Column({ type: 'varchar', length: 100, nullable: true })
  baseBranch: string | null;

  // The commit the snapshot was taken from, and path → sha256 of every file the worker was given: the result is diffed against this,
  // and the branch is cut from exactly this commit.
  @Column({ type: 'varchar', length: 64, nullable: true })
  baseSha: string | null;

  // Not selected by default: it is large and only publishing reads it.
  @Column({ type: 'text', nullable: true, select: false })
  baseline: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  branch: string | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  prNumber: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  prUrl: string | null;

  // Set when the worker's result included an issue request (see ISSUE_MARKER_PATH); independent of prNumber/prUrl —
  // a run can open an issue, a pull request, both, or neither.
  @Column({ type: 'int', unsigned: true, nullable: true })
  issueNumber: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  issueUrl: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
