import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

export type ScriptUpdateStatus =
  'pending' | 'applied' | 'failed' | 'cancelled' | 'expired';

// 'auto': bridge made the decision itself (R2), in the window the owner chose.
export type ScriptUpdateVia = 'telegram' | 'ui' | 'auto';

// 'scripts': install the board's scripts from `main`. 'worker': pull the worker image and recreate the board's worker container(s).
export type ScriptUpdateKind = 'scripts' | 'worker';

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

  // What the decision is for; a worker decision has no repoPaths and its sha is only the commit the owner saw.
  @Column({ type: 'varchar', length: 16, default: 'scripts' })
  kind: ScriptUpdateKind;

  // A worker decision: the release (manifest-list digest of `stable`) it was made for — so a release that failed on a board is not tried again by itself.
  @Column({ type: 'varchar', length: 80, nullable: true })
  targetDigest: string | null;

  // What the agent said when it was done.
  @Column({ type: 'text', nullable: true })
  result: string | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
