import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

export type ScriptStatus = 'current' | 'outdated' | 'missing';

// One script a board has (or should have), as the board's agent last saw it next to the same file on `main`.
export interface BoardScript {
  installed: string;
  repoPath: string;
  status: ScriptStatus;
  installedHash: string | null;
  mainHash: string | null;
}

// What a board last told bridge about the scripts installed on it. One row per (account, board): the board's own agent posts it
// (see infra/boardagent), and the page "Платы" and the Telegram message are made from it.
@Entity({ name: 'board_reports' })
@Index(['userId', 'host'], { unique: true })
export class BoardReport extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'varchar', length: 100 })
  host: string;

  @Column({ type: 'timestamp' })
  reportedAt: Date;

  // The commit of `main` the scripts were compared with.
  @Column({ type: 'varchar', length: 40 })
  mainSha: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  agentVersion: string | null;

  @Column({ type: 'jsonb' })
  scripts: BoardScript[];

  // What was last announced to Telegram for this board (a hash of the outdated set), so a still-outdated board is announced once,
  // not at every report; null while everything is current.
  @Column({ type: 'varchar', length: 64, nullable: true })
  announcedKey: string | null;
}
