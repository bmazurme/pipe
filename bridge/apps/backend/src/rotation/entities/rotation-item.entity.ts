import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// One row per (account, thing on the rotation calendar — rotation.ts CATALOG). `lastRotatedAt` is what the owner marked; `notifiedAt` keeps the reminder
// to once a week.
@Entity({ name: 'rotation_items' })
@Index(['userId', 'key'], { unique: true })
export class RotationItem extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'varchar', length: 40 })
  key: string;

  @Column({ type: 'timestamp', nullable: true })
  lastRotatedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  notifiedAt: Date | null;
}
