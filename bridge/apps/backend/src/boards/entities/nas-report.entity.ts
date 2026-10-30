import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import type { NasData } from '../nas';

// What a NAS last told bridge about itself (infra/nas/report.sh, via the boards-agent route). One row per (account, NAS name).
@Entity({ name: 'nas_reports' })
@Index(['userId', 'host'], { unique: true })
export class NasReport extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'varchar', length: 100 })
  host: string;

  @Column({ type: 'timestamp' })
  reportedAt: Date;

  @Column({ type: 'jsonb' })
  data: NasData;
}
