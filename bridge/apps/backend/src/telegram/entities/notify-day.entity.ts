import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// How many messages the bridge sent the owner on one day, and how many it did NOT send (R6, alert-budget.ts): the number the alert budget is
// measured by. One row per local day.
@Entity({ name: 'notify_days' })
export class NotifyDay extends BaseEntity {
  // The owner's local date, YYYY-MM-DD.
  @Index('IDX_notify_days_day', { unique: true })
  @Column({ type: 'varchar', length: 10 })
  day: string;

  // Ordinary messages that left (a grouped burst message and a morning digest are one each).
  @Column({ type: 'int', default: 0 })
  sent: number;

  // Urgent messages that left.
  @Column({ type: 'int', default: 0 })
  urgent: number;

  // Repeats of a message word for word (not said again).
  @Column({ type: 'int', default: 0 })
  deduped: number;

  // Messages folded into a burst message instead of leaving one by one.
  @Column({ type: 'int', default: 0 })
  grouped: number;

  // Messages kept for the morning digest by quiet hours.
  @Column({ type: 'int', default: 0 })
  quiet: number;
}
