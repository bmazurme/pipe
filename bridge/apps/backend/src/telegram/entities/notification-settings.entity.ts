import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

// Per-account notification preferences, edited on the profile page. Telegram has
// a single owner chat, so NotificationSettingsService picks one account's row for
// it (see its docs) rather than evaluating per recipient.
@Entity({ name: 'notification_settings' })
export class NotificationSettings {
  @PrimaryColumn({ type: 'int', unsigned: true })
  userId: number;

  // "HH:MM-HH:MM", or "off" to disable quiet hours entirely.
  @Column({ type: 'varchar', length: 16 })
  quietHours: string;

  // IANA zone the window is evaluated in.
  @Column({ type: 'varchar', length: 64 })
  timezone: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
