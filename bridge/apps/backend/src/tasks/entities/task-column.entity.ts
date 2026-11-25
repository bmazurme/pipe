import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { User } from '../../users/entities/user.entity';

// A column of a user's personal task board (Trello-style).
@Entity({ name: 'task_columns' })
export class TaskColumn extends BaseEntity {
  @Index()
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  // Left-to-right order on the board.
  @Column({ type: 'int', default: 0 })
  position: number;
}
