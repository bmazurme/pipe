import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// One open question a worker found in a run's output. A "card" is not stored: it is every question of one task
// (`taskKey`), and it counts as archived once all of them are resolved.
@Entity({ name: 'task_questions' })
@Index(['userId', 'taskKey'])
export class TaskQuestion extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  userId: number;

  // The run the question came from (kept for reference only — no FK, a deleted job must not take its questions with it).
  @Column({ type: 'int', unsigned: true, nullable: true })
  jobId: number | null;

  // The task, as on Job.taskKey: `<projectId>:<iid>` or `file:<id>`.
  @Column({ type: 'varchar', length: 100 })
  taskKey: string;

  // The project number the card is tagged with (the part of taskKey before the colon); null for a task without one.
  @Column({ type: 'varchar', length: 50, nullable: true })
  project: string | null;

  @Column({ type: 'varchar', length: 500 })
  text: string;

  // What the user wrote in reply; null until they do. Saving one resolves the question.
  @Column({ type: 'varchar', length: 2000, nullable: true })
  answer: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;
}
