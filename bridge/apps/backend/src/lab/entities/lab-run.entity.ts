import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

export enum LabRunStatus {
  // The row exists while bridge snapshots the repository and creates the job: a second start of the same task sees it.
  Preparing = 'preparing',
  // The worker job exists and has not finished (queued/claimed vs running).
  Queued = 'queued',
  Running = 'running',
  // The job succeeded; bridge is committing the result to a branch and opening the pull request.
  Publishing = 'publishing',
  PrOpen = 'pr_open',
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

  @Column({ type: 'varchar', length: 16 })
  model: string;

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

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
