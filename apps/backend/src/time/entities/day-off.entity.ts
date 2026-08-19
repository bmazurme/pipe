import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

export enum DayOffType {
  Off = 'off',
  Holiday = 'holiday',
  Short = 'short',
  // A weekend day that's actually a working day (a compensatory workday
  // swapped in around a holiday) — the inverse of the other three, which
  // all mark a date as non-working.
  Compensatory = 'compensatory',
}

@Entity({ name: 'day_offs' })
@Index(['userId', 'date'], { unique: true })
export class DayOff extends BaseEntity {
  @Column({ type: 'int', unsigned: true, nullable: false })
  userId: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: DayOffType, default: DayOffType.Off })
  type: DayOffType;
}
