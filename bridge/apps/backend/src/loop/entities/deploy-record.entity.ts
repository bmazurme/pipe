import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

export type DeployResult = 'deployed' | 'rolled_back' | 'failed';

// What the board that deploys (infra/autodeploy) reported about one release: it went out, it was rolled back, or it never came up.
// One row per (commit, result): a report that is sent twice (a retry after bridge itself was down) is stored once.
@Entity({ name: 'deploy_records' })
@Index(['sha', 'result'], { unique: true })
export class DeployRecord extends BaseEntity {
  @Column({ type: 'varchar', length: 40 })
  sha: string;

  // The release that was running before it, when the board knew it (short or full sha).
  @Column({ type: 'varchar', length: 40, nullable: true })
  previousSha: string | null;

  @Column({ type: 'varchar', length: 16 })
  result: DeployResult;

  @Column({ type: 'varchar', length: 500, nullable: true })
  detail: string | null;

  // The pull requests that rolled out in it, from the commit subjects between the two releases; empty when GitHub could not be asked.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  prNumbers: number[];
}
