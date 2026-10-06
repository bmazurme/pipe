import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { LoopRun } from './loop-run.entity';

// Append-only audit log of everything the loop saw — including events that
// matched no run (runId null), so a webhook that "did nothing" is still
// visible when debugging why a run never advanced.
@Entity({ name: 'loop_events' })
export class LoopEvent extends BaseEntity {
  @Index()
  @Column({ type: 'int', unsigned: true, nullable: true })
  runId: number | null;

  @ManyToOne(() => LoopRun, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'runId' })
  run: LoopRun | null;

  @Column({ type: 'varchar', length: 32 })
  source: string;

  @Column({ type: 'varchar', length: 64 })
  type: string;

  @Column({ type: 'varchar', length: 500 })
  summary: string;
}
