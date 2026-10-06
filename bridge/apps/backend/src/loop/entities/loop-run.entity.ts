import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// One pass of the self-improvement cycle (see SELF_IMPROVEMENT_PLAN.md):
// analyze → plan → execute → PR → CI → deploy → verify. The stage is advanced
// by the loop controller from GitHub webhooks (and, in later stages, from
// worker reports) — never set by the browser.
export enum LoopStage {
  Analyzing = 'analyzing',
  Planned = 'planned',
  Executing = 'executing',
  PrOpen = 'pr_open',
  Ci = 'ci',
  Deploying = 'deploying',
  Verifying = 'verifying',
  Done = 'done',
  Failed = 'failed',
}

export const TERMINAL_LOOP_STAGES: readonly LoopStage[] = [
  LoopStage.Done,
  LoopStage.Failed,
];

// Branches the executor pushes are named `loop/run-<id>[-slug]`, which is how
// a PR/workflow event is correlated back to its run without a lookup table.
export const LOOP_BRANCH_PREFIX = 'loop/run-';

@Entity({ name: 'loop_runs' })
export class LoopRun extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 32, default: LoopStage.Analyzing })
  stage: LoopStage;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Index()
  @Column({ type: 'int', nullable: true })
  prNumber: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  branch: string | null;

  // Last failure reason; cleared when the run recovers (e.g. CI goes green
  // after a fix is pushed to the same PR).
  @Column({ type: 'text', nullable: true })
  error: string | null;
}
