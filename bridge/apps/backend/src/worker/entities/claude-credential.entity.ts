import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
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

  @Column({ type: 'text' })
  token: string;
}
