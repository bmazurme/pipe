import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import type { ProbeResult } from '../links';

// The latest probe of one channel (host:port) from one vantage point. Only the latest is kept, plus when its result last changed.
@Entity({ name: 'link_probes' })
@Index(['vantage', 'channelKey'], { unique: true })
export class LinkProbe extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  vantage: string;

  @Column({ type: 'varchar', length: 255 })
  channelKey: string;

  @Column({ type: 'varchar', length: 20 })
  result: ProbeResult;

  @Column({ type: 'int', nullable: true })
  tcpMs: number | null;

  @Column({ type: 'int', nullable: true })
  tlsMs: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  detail: string | null;

  @Column({ type: 'timestamp' })
  probedAt: Date;

  @Column({ type: 'timestamp' })
  changedAt: Date;
}
