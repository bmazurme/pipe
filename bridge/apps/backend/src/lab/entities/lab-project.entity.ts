import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { encryptedColumn } from '../../crypto/encrypted-column.transformer';

// A GitHub repository the owner of the account connects to Lab with their OWN token: Lab reads it (a snapshot for the worker) and
// writes to it (a branch and a pull request with what the worker made). Never merges anything.
@Entity({ name: 'lab_projects' })
@Index(['userId'])
export class LabProject extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  // 'owner/name'.
  @Column({ type: 'varchar', length: 200 })
  repo: string;

  // The branch snapshots are taken from and pull requests are opened against.
  @Column({ type: 'varchar', length: 100, default: 'main' })
  baseBranch: string;

  // The owner's personal access token. Encrypted at rest (AES-256-GCM via encryptedColumn) and never returned by any route:
  // the lists only carry tokenHint.
  @Column({ type: 'text', transformer: encryptedColumn })
  token: string;

  // The last characters of the token, so two tokens can be told apart on screen.
  @Column({ type: 'varchar', length: 16 })
  tokenHint: string;

  // When the connection was last checked (read + a harmless write probe), and whether writing worked.
  @Column({ type: 'timestamp', nullable: true })
  checkedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  canWrite: boolean;
}
