import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import type { CloudData } from '../cloud';

// What the cloud VM last told bridge about itself (infra/cloudagent/report.sh, via the boards-agent route). One row per (account, VM name).
@Entity({ name: 'cloud_reports' })
@Index(['userId', 'host'], { unique: true })
export class CloudReport extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'varchar', length: 100 })
  host: string;

  @Column({ type: 'timestamp' })
  reportedAt: Date;

  @Column({ type: 'jsonb' })
  data: CloudData;
}
