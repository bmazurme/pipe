import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// The latest check of one copy of the backup key (infra/backup/key-check.sh, via the boards-agent route): did this copy decrypt the newest backup.
// `lastOkAt` survives a later failure — «worked in March, failed today» is a different problem from «never worked».
@Entity({ name: 'key_copy_checks' })
@Index(['userId', 'label'], { unique: true })
export class KeyCopyCheck extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'varchar', length: 40 })
  label: string;

  @Column({ type: 'timestamp' })
  lastCheckAt: Date;

  @Column({ type: 'boolean' })
  ok: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastOkAt: Date | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  backupCreatedAt: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  error: string | null;
}
