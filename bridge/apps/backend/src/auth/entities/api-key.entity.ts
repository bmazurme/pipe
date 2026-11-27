import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { User } from '../../users/entities/user.entity';
import type { ApiKeyScope } from '../api-key-scope';

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

  // null = a full key; otherwise what the key is limited to (api-key-scope.ts): 'boards' = only routes marked BoardAgentKeyAllowed,
  // 'readonly' = reads only, 'reports-sync' = what reports' own server calls.
  @Column({ type: 'varchar', length: 16, nullable: true })
  scope: ApiKeyScope | null;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  // null = never expires; a key past this moment is refused by validate().
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  // S5: the owner was told (once) that this key runs out soon / has not been used for a month — see keyHygiene.
  @Column({ type: 'timestamp', nullable: true })
  notifiedExpiringAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  notifiedStaleAt: Date | null;
}
