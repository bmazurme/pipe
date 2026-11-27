import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

export type OutcomeState = 'open' | 'merged' | 'closed';
export type FirstCi = 'success' | 'failure' | 'none';

// What became of one pull request an Improve run opened (A1): the measure of how good the assistant is — did the first attempt pass CI, how
// many repairs it needed, how long until it was merged, what it cost, whether it had to be reverted. One row per pull request, kept up to
// date from GitHub by ImproveQualityService until the outcome can no longer change.
@Entity({ name: 'improve_outcomes' })
@Index('IDX_improve_outcomes_userId_prNumber', ['userId', 'prNumber'], {
  unique: true,
})
export class ImproveOutcome extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'int', unsigned: true })
  prNumber: number;

  // The run that opened it (the first one with this pull request).
  @Column({ type: 'int', unsigned: true })
  runId: number;

  @Column({ type: 'varchar', length: 16 })
  model: string;

  // The size tier the router gave the task, when it was routed.
  @Column({ type: 'smallint', nullable: true })
  tier: number | null;

  @Column({ type: 'varchar', length: 8, default: 'open' })
  state: OutcomeState;

  // CI on the commit the pull request was opened with; null while it has not finished.
  @Column({ type: 'varchar', length: 8, nullable: true })
  firstCi: FirstCi | null;

  // Automatic CI repairs (runs of kind `repair`, trigger `ci`) the pull request needed.
  @Column({ type: 'smallint', default: 0 })
  ciRepairs: number;

  // What all the runs of this pull request cost (the Claude CLI's own figure, API-price equivalent); null when none of them reported one.
  @Column({ type: 'double precision', nullable: true })
  costUsd: number | null;

  @Column({ type: 'timestamp' })
  openedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  mergedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date | null;

  // A9: the model this work started on when it needed one more attempt a step up (the pull request, or its CI repairs, ended on a stronger one);
  // null when it never escalated.
  @Column({ type: 'varchar', length: 16, nullable: true })
  escalatedFrom: string | null;

  // A later pull request reverted this one.
  @Column({ type: 'boolean', default: false })
  reverted: boolean;

  @Column({ type: 'timestamp' })
  checkedAt: Date;
}
