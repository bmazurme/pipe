import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { User } from '../../users/entities/user.entity';
import { TaskColumn } from './task-column.entity';

// A card: only a title and a description. Archiving hides it from the board
// without deleting it.
@Entity({ name: 'task_cards' })
export class TaskCard extends BaseEntity {
  @Index()
  @Column({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index()
  @Column({ type: 'int', unsigned: true })
  columnId: number;

  @ManyToOne(() => TaskColumn, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'columnId' })
  column: TaskColumn;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  // Top-to-bottom order inside the column.
  @Column({ type: 'int', default: 0 })
  position: number;

  // null = on the board; set = in the archive.
  @Column({ type: 'timestamp', nullable: true })
  archivedAt: Date | null;
}
