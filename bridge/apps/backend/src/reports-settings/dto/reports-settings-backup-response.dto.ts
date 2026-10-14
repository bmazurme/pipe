import { ReportsSettingsBackup } from '../entities/reports-settings-backup.entity';

// The bridge-page listing only ever needs "is there one, and when" — the
// payload itself comes back from the separate GET used by reports' own pull.
export class ReportsSettingsBackupResponseDto {
  updatedAt: Date;

  static fromEntity(
    backup: ReportsSettingsBackup,
  ): ReportsSettingsBackupResponseDto {
    return { updatedAt: backup.updatedAt };
  }
}
