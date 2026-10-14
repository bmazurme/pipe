import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { User } from '../../users/entities/user.entity';
import type { ClaudeLimits } from '../claude-limits';
import { JobModel } from './job.entity';

// A worker process the owner added in the UI. It joins with a one-time enrollment code (no secret in its
// environment) and from then on authenticates with its own key, scoped to worker routes only. Everything about
// how it behaves — whether it takes work, which models, timeouts, proxy — is set here and fetched by the worker.
@Entity({ name: 'workers' })
@Index(['userId', 'name'], { unique: true })
export class Worker extends BaseEntity {
  @Index()
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  // false = paused: it stays connected but is not given work.
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  // SHA-256 of the worker's key; null until the enrollment code has been used. The key itself exists only on the worker.
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  keyHash: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  keyPrefix: string | null;

  // SHA-256 of the pending one-time enrollment code and when it stops working.
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  enrollCodeHash: string | null;

  @Column({ type: 'timestamp', nullable: true })
  enrollExpiresAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastSeenAt: Date | null;

  // Self-reported by the worker at enrollment (informational).
  @Column({ type: 'varchar', length: 255, nullable: true })
  hostname: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  version: string | null;

  // Which models this worker may run; null = all of them.
  @Column({ type: 'simple-array', nullable: true })
  models: JobModel[] | null;

  @Column({ type: 'smallint', default: 10 })
  pollIntervalSec: number;

  // Wall-clock limit for one job on this worker.
  @Column({ type: 'int', default: 1800 })
  jobTimeoutSec: number;

  // HTTP proxy this worker uses to reach AI providers (geo-blocked hosts); null = direct.
  @Column({ type: 'varchar', length: 500, nullable: true })
  proxyUrl: string | null;

  // Whether it also answers Chat turns.
  @Column({ type: 'boolean', default: true })
  chatEnabled: boolean;

  // The Claude plan limits last reported by a run on this worker (claude-limits.ts).
  @Column({ type: 'jsonb', nullable: true })
  claudeLimits: ClaudeLimits | null;
}
