import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { User } from '../../users/entities/user.entity';

// The last-resort way in when neither Yandex nor GitHub works (docs/ha-dr-plan.md §7.5). One per user: a new one
// replaces the old. Deliberately NOT an ApiKey: it cannot call the API as a machine, it can only be exchanged for a
// browser session at POST /auth/emergency-login.
@Entity({ name: 'emergency_keys' })
export class EmergencyKey extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // First characters of the token, kept in the clear so the profile can show "bre_9fJ3…" without the secret.
  @Column({ type: 'varchar', length: 16 })
  prefix: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  keyHash: string;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;
}
