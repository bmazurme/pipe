import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { User } from '../../users/entities/user.entity';

// One of the ten single-use codes shown once when 2FA is switched on — the way back when the phone is lost.
@Entity({ name: 'recovery_codes' })
export class RecoveryCode extends BaseEntity {
  @Index()
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  codeHash: string;

  @Column({ type: 'timestamp', nullable: true })
  usedAt: Date | null;
}
