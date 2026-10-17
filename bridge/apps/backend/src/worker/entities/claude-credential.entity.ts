import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { encryptedColumn } from '../../crypto/encrypted-column.transformer';
import type { ClaudeLimits } from '../claude-limits';
import { User } from '../../users/entities/user.entity';

// A named Claude Code OAuth token (the `claude setup-token` output —
// the same kind of value WORKER_CLAUDE_CODE_OAUTH_TOKEN already carries as a
// single GitHub secret), stored here so an account can hold several, pick
// one per job, and add/rotate them without a GitHub-secret round trip and a
// full worker redeploy. Held in the clear (not hashed, unlike ApiKey) —
// worker needs the actual value handed back to it, not just proof of a
// match.
@Entity({ name: 'claude_credentials' })
export class ClaudeCredential extends BaseEntity {
  @Index()
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // Human label so a listing tells tokens apart ("personal", "team seat 2").
  @Column({ type: 'varchar', length: 255 })
  name: string;

  // Encrypted at rest (AES-256-GCM via encryptedColumn) — a DB dump or
  // pgadmin access no longer hands over a usable Claude OAuth token.
  @Column({ type: 'text', transformer: encryptedColumn })
  token: string;

  // The plan limits last reported by a run on this token (claude-limits.ts), and when.
  @Column({ type: 'jsonb', nullable: true })
  limits: ClaudeLimits | null;

  // Set when a job that ran on this token failed to authenticate (Anthropic no longer accepts it), and which
  // job; cleared again when a later run or limits probe on the token succeeds.
  @Column({ type: 'timestamp', nullable: true })
  authFailedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  authFailedJobId: number | null;
}
