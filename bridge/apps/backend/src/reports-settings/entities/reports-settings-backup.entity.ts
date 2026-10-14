import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { encryptedColumn } from '../../crypto/encrypted-column.transformer';
import { User } from '../../users/entities/user.entity';

// One backup slot per user, overwritten on every sync — reports' own
// `SettingsBundleType`, opaque to bridge (it doesn't parse it, only stores
// and returns it). Encrypted at rest like Secret.value/ClaudeCredential.token:
// the bundle carries a GitLab token and bridge API keys in the clear.
@Entity({ name: 'reports_settings_backups' })
export class ReportsSettingsBackup extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'text', transformer: encryptedColumn })
  payload: string;
}
