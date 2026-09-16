import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'api_keys' })
export class ApiKey extends BaseEntity {
  @Index()
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // Human label so a listing tells keys apart ("sync-cli on macbook").
  @Column({ type: 'varchar', length: 255 })
  name: string;

  // First ~12 chars of the token, kept in the clear so a listing can show
  // "brk_9fJ3kL…" without ever storing or re-displaying the full secret.
  @Column({ type: 'varchar', length: 16 })
  prefix: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  keyHash: string;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;
}
