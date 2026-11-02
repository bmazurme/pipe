import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import type { RouterData } from '../router';

// What the router last looked like to the agent (infra/router, via the boards-agent route). One row per (account, router name).
@Entity({ name: 'router_reports' })
@Index(['userId', 'host'], { unique: true })
export class RouterReport extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'varchar', length: 100 })
  host: string;

  @Column({ type: 'timestamp' })
  reportedAt: Date;

  @Column({ type: 'jsonb' })
  data: RouterData;
}
