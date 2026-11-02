import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import type { UpsData } from '../ups';

// What a UPS last told bridge about itself (infra/ups/report.sh, via the boards-agent route). One row per (account, board it is plugged into).
@Entity({ name: 'ups_reports' })
@Index(['userId', 'host'], { unique: true })
export class UpsReport extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'varchar', length: 100 })
  host: string;

  @Column({ type: 'timestamp' })
  reportedAt: Date;

  @Column({ type: 'jsonb' })
  data: UpsData;
}
