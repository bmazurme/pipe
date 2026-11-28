import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import type { DrillData } from '../restore-drill';

// One run of the restore drill (infra/backup/restore-drill.sh, via the boards-agent route). History, unlike the NAS/UPS reports: «was it
// done in the last 35 days» and «did the row counts shrink» both need the earlier runs. The service keeps the newest few.
@Entity({ name: 'restore_drills' })
@Index(['userId', 'ranAt'])
export class RestoreDrill extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'timestamp' })
  ranAt: Date;

  @Column({ type: 'jsonb' })
  data: DrillData;
}
