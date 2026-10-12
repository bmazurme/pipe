import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { User } from '../../users/entities/user.entity';

export const AUTH_PROVIDERS = ['yandex', 'github'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

/** Prefix of a providerUserId backfilled by the migration, before the real provider id was ever seen. */
export const LEGACY_PROVIDER_ID_PREFIX = 'legacy:';

// One way a user can sign in. `enabled` lets a user switch a method off from
// the profile without losing the link; the server keeps at least one enabled
// (IdentitiesService.assertNotLast).
@Entity({ name: 'auth_identities' })
@Index(['provider', 'providerUserId'], { unique: true })
@Index(['userId', 'provider'], { unique: true })
export class AuthIdentity extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 16 })
  provider: AuthProvider;

  // The provider's stable account id, never the email (an email can change hands).
  @Column({ type: 'varchar', length: 255 })
  providerUserId: string;

  // As the provider reported it — shown in the profile, not used for lookup.
  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;
}
