import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// How often a KIND of message (its first line, digits as N) was attempted on a day — who is noisy, whether or not it was sent (R6).
@Entity({ name: 'notify_kinds' })
@Index('IDX_notify_kinds_day_kind', ['day', 'kind'], { unique: true })
export class NotifyKind extends BaseEntity {
  @Column({ type: 'varchar', length: 10 })
  day: string;

  @Column({ type: 'varchar', length: 60 })
  kind: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;
}
