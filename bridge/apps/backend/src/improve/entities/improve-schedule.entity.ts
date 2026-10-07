import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// "Every night at 02:00 run the 5 oldest open `loop` issues" — one row.
@Entity({ name: 'improve_schedules' })
export class ImproveSchedule extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  // Local wall-clock time in `timezone`.
  @Column({ type: 'smallint' })
  hour: number;

  @Column({ type: 'smallint' })
  minute: number;

  @Column({ type: 'varchar', length: 64 })
  timezone: string;

  // How many issues to start per run.
  @Column({ type: 'smallint' })
  count: number;

  @Column({ type: 'varchar', length: 16 })
  model: string;

  // Which issues are eligible: open and carrying this label.
  @Column({ type: 'varchar', length: 64, default: 'loop' })
  label: string;

  // Local date ("YYYY-MM-DD") of the last time this fired — the guard that makes a
  // schedule fire once per day even though it is checked every minute.
  @Column({ type: 'varchar', length: 10, nullable: true })
  lastRunOn: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastRunAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastResult: string | null;
}
