import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

export type ScriptUpdateStatus =
  'pending' | 'applied' | 'failed' | 'cancelled' | 'expired';

export type ScriptUpdateVia = 'telegram' | 'ui';

// The owner's decision to bring a board's scripts up to `main` at one commit. The board's agent picks it up, installs those
// scripts (only ones it already knows, from that commit, only if the commit is on `main`) and reports how it went.
@Entity({ name: 'script_updates' })
@Index(['userId', 'host', 'status'])
export class ScriptUpdate extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'varchar', length: 100 })
  host: string;

  // The commit to install from.
  @Column({ type: 'varchar', length: 40 })
  sha: string;

  // Paths in the repository (infra/…): what to install. The board maps each to where it lives on that board.
  @Column({ type: 'jsonb' })
  repoPaths: string[];

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: ScriptUpdateStatus;

  @Column({ type: 'varchar', length: 16 })
  via: ScriptUpdateVia;

  // What the agent said when it was done.
  @Column({ type: 'text', nullable: true })
  result: string | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
