import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// R2: whether bridge updates the workers on the boards by itself, and in which daily window. Off until the owner switches it on.
@Entity({ name: 'board_auto_update_settings' })
@Index('IDX_board_auto_update_settings_userId', ['userId'], { unique: true })
export class BoardAutoUpdateSettings extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  // «03:00-05:00»: the same notation as the quiet hours; the window may cross midnight.
  @Column({ type: 'varchar', length: 16, default: '03:00-05:00' })
  window: string;

  @Column({ type: 'varchar', length: 64, default: 'Europe/Moscow' })
  timezone: string;
}
