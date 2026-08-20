import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'sessions' })
export class Session extends BaseEntity {
  @Index()
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 255 })
  refreshTokenHash: string;

  // Refresh tokens rotate on every use — the hash above always holds the one
  // valid cookie value. These two hold the *previous* hash for a short grace
  // window after a rotation, so that a second request racing the first on
  // the same (now-superseded) cookie — two browser tabs, a poller landing
  // next to a manual action — still validates instead of being told its
  // token is invalid and logging the user out. See SessionsService.validateSession.
  @Column({ type: 'varchar', length: 255, nullable: true })
  previousRefreshTokenHash: string | null;

  @Column({ type: 'timestamp', nullable: true })
  previousRefreshTokenExpiresAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;
}
