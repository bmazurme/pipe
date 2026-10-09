import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../base.entity';
import { Chat } from './chat.entity';

// A file or image the user attached to a chat message. Uploaded first (messageId null,
// "pending"), then linked to the message it is sent with. The bytes live on disk under
// uploads/chat; only Claude chats take them (see attachments.ts).
@Entity({ name: 'chat_attachments' })
@Index(['chatId'])
@Index(['messageId'])
export class ChatAttachment extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  chatId: number;

  @ManyToOne(() => Chat, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chatId' })
  chat: Chat;

  @Column({ type: 'int', unsigned: true })
  userId: number;

  // Null until the message the file was uploaded for is actually sent.
  @Column({ type: 'int', unsigned: true, nullable: true })
  messageId: number | null;

  @Column({ type: 'varchar', length: 255 })
  originalName: string;

  @Column({ type: 'varchar', length: 255 })
  storedName: string;

  @Column({ type: 'int', unsigned: true })
  size: number;
}
