import { Column, Entity, Index } from 'typeorm';

import { encryptedColumn } from '../../crypto/encrypted-column.transformer';
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

  // Snapshot of the saved Context attached when the chat was created (later edits or
  // deletion of the Context do not touch it). The text is only ever handed to the
  // worker when it claims a turn; human-facing routes see the name.
  @Column({ type: 'varchar', length: 255, nullable: true })
  contextName: string | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedColumn })
  contextText: string | null;
}
