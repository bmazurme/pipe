import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { encryptedColumn } from '../../crypto/encrypted-column.transformer';
import { User } from '../../users/entities/user.entity';

// The second factor for dangerous actions (DEVELOPMENT-PLAN.md S6): one TOTP secret per user. A row with a null
// `enabledAt` is a setup that was started but never confirmed with a first code — it protects nothing yet.
@Entity({ name: 'user_totp' })
export class UserTotp extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // base32, AES-256-GCM at rest like every other stored secret (CREDENTIALS_ENC_KEY).
  @Column({ type: 'text', transformer: encryptedColumn })
  secret: string;

  @Column({ type: 'timestamp', nullable: true })
  enabledAt: Date | null;

  // The newest 30-second step already spent; a code from that step or older is refused (replay).
  @Column({
    type: 'bigint',
    default: 0,
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  lastStep: number;
}
