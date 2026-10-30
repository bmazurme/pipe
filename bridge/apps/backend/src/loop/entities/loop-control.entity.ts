import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export const LOOP_CONTROL_ID = 1;

// Who stopped the automation: the owner from Telegram or the page, or bridge itself (a deploy that rolled back).
export type LoopPausedBy = 'telegram' | 'owner' | 'deploy';

// The kill-switch of the self-improvement cycle: one row. While `paused`, nothing starts new automatic work (scheduled analyses and runs,
// auto-started parcels, CI repairs and the other things done to open pull requests); what the owner does by hand, and merging, is not affected.
@Entity({ name: 'loop_control' })
export class LoopControl {
  @PrimaryColumn({ type: 'int', unsigned: true })
  id: number;

  @Column({ type: 'boolean', default: false })
  paused: boolean;

  @Column({ type: 'varchar', length: 300, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  pausedBy: LoopPausedBy | null;

  @Column({ type: 'timestamp', nullable: true })
  pausedAt: Date | null;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
