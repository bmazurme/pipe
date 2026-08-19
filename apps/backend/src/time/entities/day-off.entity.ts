import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

export enum DayOffType {
  Off = 'off',
  Holiday = 'holiday',
  Short = 'short',
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
