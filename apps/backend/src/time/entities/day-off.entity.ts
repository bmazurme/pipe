import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

@Entity({ name: 'day_offs' })
@Index(['userId', 'date'], { unique: true })
export class DayOff extends BaseEntity {
  @Column({ type: 'int', unsigned: true, nullable: false })
  userId: number;

  @Column({ type: 'date' })
  date: string;
}
