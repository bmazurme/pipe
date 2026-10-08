import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

export enum ImproveRunStatus {
  // The worker job exists and has not finished (queued/claimed vs running).
  Queued = 'queued',
  Running = 'running',
  // The job succeeded; bridge is committing the result to a branch and opening the PR.
  Publishing = 'publishing',
  PrOpen = 'pr_open',
  // The run finished but changed nothing worth a PR.
  NoChanges = 'no_changes',
  Failed = 'failed',
  Cancelled = 'cancelled',
  // An analysis run that finished: its proposals are in `result`, and (when asked) already filed as issues.
  Analyzed = 'analyzed',
}

export const ACTIVE_RUN_STATUSES = [
  ImproveRunStatus.Queued,
  ImproveRunStatus.Running,
  ImproveRunStatus.Publishing,
];

export type ImproveTrigger = 'manual' | 'schedule';
export type ImproveRunKind = 'issue' | 'analysis';

// One attempt to implement one GitHub issue: snapshot → worker job → branch + PR.
@Entity({ name: 'improve_runs' })
@Index(['issueNumber', 'status'])
export class ImproveRun extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  // 'issue' implements one GitHub issue; 'analysis' reads the repo and proposes some.
  @Column({ type: 'varchar', length: 16, default: 'issue' })
  kind: ImproveRunKind;

  // Null for an analysis (it is not about one issue).
  @Column({ type: 'int', unsigned: true, nullable: true })
  issueNumber: number | null;

  @Column({ type: 'varchar', length: 255 })
  issueTitle: string;

  @Column({ type: 'varchar', length: 16 })
  model: string;

  @Column({ type: 'varchar', length: 16, default: 'manual' })
  trigger: ImproveTrigger;

  @Column({ type: 'int', unsigned: true, nullable: true })
  scheduleId: number | null;

  @Column({ type: 'varchar', length: 24, default: ImproveRunStatus.Queued })
  status: ImproveRunStatus;

  @Column({ type: 'int', unsigned: true, nullable: true })
  jobId: number | null;

  // The commit the snapshot was taken from, and a path → sha256 of every file the
  // worker was given. The result is diffed against this, and the branch is cut from
  // exactly this commit.
  @Column({ type: 'varchar', length: 64, nullable: true })
  baseSha: string | null;

  @Column({ type: 'text', nullable: true })
  baseline: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  branch: string | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  prNumber: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  prUrl: string | null;

  // Analysis only: JSON of { categories, autoCreate, items: [{ category, title, risk,
  // body, issueNumber?, duplicateOf? }] }.
  @Column({ type: 'text', nullable: true })
  result: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
