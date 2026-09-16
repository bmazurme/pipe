import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

@Entity({ name: 'purge_entries' })
@Index(['userId', 'key'], { unique: true })
@Index(['userId', 'value'], { unique: true })
export class PurgeEntry extends BaseEntity {
  @Column({ type: 'int', unsigned: true, nullable: false })
  userId: number;

  @Column({ type: 'varchar', length: 255, nullable: false })
  key: string;

  @Column({ type: 'varchar', length: 500, nullable: false })
  value: string;
}
