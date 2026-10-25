import { Column, Entity, Index } from 'typeorm';

import type { LabExecutor } from '../lab-executor';
import { BaseEntity } from '../../base.entity';

// "Every night at 02:00 do THIS in that repository" — one row. THIS is the owner's own text: there are no task types to tick.
@Entity({ name: 'lab_schedules' })
@Index(['userId'])
export class LabSchedule extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'int', unsigned: true })
  projectId: number;

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

  // ISO weekdays (1 = Mon … 7 = Sun, in `timezone`) the schedule fires on; null = every day.
  @Column({ type: 'smallint', array: true, nullable: true })
  weekdays: number[] | null;

  // Scheduled runs are skipped while the base branch head is the commit the previous run worked on.
  @Column({ type: 'boolean', default: false })
  onlyOnNewCommits: boolean;

  @Column({ type: 'varchar', length: 16 })
  model: string;

  // Where it runs: 'any' worker (default) or a 'fusion' one (see lab-executor.ts).
  @Column({ type: 'varchar', length: 16, default: 'any' })
  executor: LabExecutor;

  // What the worker is asked to do in the repository, in the owner's words.
  @Column({ type: 'text' })
  task: string;

  // A saved Context attached to every run of this schedule, or null.
  @Column({ type: 'int', unsigned: true, nullable: true })
  contextId: number | null;

  // Today's slot, claimed before the schedule fires so two ticks never fire it twice.
  @Column({ type: 'varchar', length: 10, nullable: true })
  lastRunOn: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastRunAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastResult: string | null;
}
