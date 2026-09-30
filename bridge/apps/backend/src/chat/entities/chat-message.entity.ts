import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

export enum ChatMessageRole {
  User = 'user',
  Assistant = 'assistant',
}

// A user message is always 'complete' the moment it's saved. Its paired
// assistant reply starts 'pending' in the very same request (see
// ChatService.sendMessage) — that's what gives the frontend something to
// poll immediately, without a second round trip. 'running' exists so a
// claim durably marks a message as taken (a plain SKIP LOCKED row lock
// only lasts for the claiming UPDATE's own transaction, not for the whole
// turn) — without it, a second worker polling before the first one
// finishes would claim the same still-'pending' row again.
export enum ChatMessageStatus {
  Pending = 'pending',
  Running = 'running',
  Complete = 'complete',
  Failed = 'failed',
}

@Entity({ name: 'chat_messages' })
@Index(['chatId'])
export class ChatMessage extends BaseEntity {
  @Column({ type: 'int', unsigned: true, nullable: false })
  chatId: number;

  @Column({ type: 'enum', enum: ChatMessageRole })
  role: ChatMessageRole;

  @Column({ type: 'text', default: '' })
  content: string;

  @Column({
    type: 'enum',
    enum: ChatMessageStatus,
    default: ChatMessageStatus.Complete,
  })
  status: ChatMessageStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;
}
