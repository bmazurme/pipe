import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

@Entity({ name: 'time_report_entries' })
@Index(['userId', 'year', 'month'])
export class TimeReportEntry extends BaseEntity {
  @Column({ type: 'int', unsigned: true, nullable: false })
  userId: number;

  @Column({ type: 'int', nullable: false })
  year: number;

  @Column({ type: 'int', nullable: false })
  month: number;

  @Column({ type: 'varchar', length: 500, nullable: false })
  taskName: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  status: string;

  @Column({
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: false,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  hours: number;
}
