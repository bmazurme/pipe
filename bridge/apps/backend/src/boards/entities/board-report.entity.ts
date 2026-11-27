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

// A worker container the board's agent found on it (named pipe-worker-pi-…), with the image it runs and whether it is up.
export interface BoardWorker {
  name: string;
  image: string;
  running: boolean;
  // Since the container was created (an update starts it again at 0), when it last started, and whether the kernel killed it for memory;
  // all optional — an agent older than version 4 does not say.
  restartCount?: number;
  startedAt?: string;
  oomKilled?: boolean;
}

// What the board reported about its disk and SSH; every field optional (see BoardHealthDto).
export interface BoardHealth {
  diskUsedPct?: number;
  diskFreeMb?: number;
  inodesUsedPct?: number;
  sshPasswordAuth?: boolean;
  sshAuthorizedKeys?: number;
  sshdActive?: boolean;
  workers?: BoardWorker[];
  // S1(3): whether the filter that keeps worker containers off the home network is in place; said only by a board that has workers.
  workerEgress?: boolean;
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

  // Null for a board whose agent predates health reporting.
  @Column({ type: 'jsonb', nullable: true })
  health: BoardHealth | null;

  // What was last announced to Telegram for this board (a hash of the outdated set), so a still-outdated board is announced once,
  // not at every report; null while everything is current.
  @Column({ type: 'varchar', length: 64, nullable: true })
  announcedKey: string | null;
}
