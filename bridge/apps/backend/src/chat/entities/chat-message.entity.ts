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
@Index('IDX_chat_messages_pending', ['createdAt'], {
  where: "status = 'pending'",
})
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

  // What the model has written so far while the turn is running (the worker reports it every second or two), so the chat
  // can show the reply growing instead of a bare loader. Cleared the moment the turn completes or fails.
  @Column({ type: 'text', nullable: true })
  progress: string | null;

  // The model's reasoning behind this reply (Claude sonnet/opus/haiku only — gpt/deepseek/qwen chats never report one),
  // kept once the turn completes so it can be shown collapsed behind a toggle. Unlike `progress`, never cleared.
  @Column({ type: 'text', nullable: true })
  reasoning: string | null;
}
