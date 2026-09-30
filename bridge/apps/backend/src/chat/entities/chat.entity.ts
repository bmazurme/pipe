import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// Same five values as worker/entities/job.entity.ts's JobModel — kept as a
// separate enum rather than shared, since chat and jobs are independent
// concepts that only happen to offer the same model choices today.
export enum ChatModel {
  Sonnet = 'sonnet',
  Opus = 'opus',
  Gpt = 'gpt',
  Deepseek = 'deepseek',
  Qwen = 'qwen',
}

@Entity({ name: 'chats' })
@Index(['userId'])
export class Chat extends BaseEntity {
  @Column({ type: 'int', unsigned: true, nullable: false })
  userId: number;

  @Column({ type: 'enum', enum: ChatModel })
  model: ChatModel;

  // Left null and derived client-side from the first message by default —
  // never auto-generated server-side (would need its own model call).
  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;
}
