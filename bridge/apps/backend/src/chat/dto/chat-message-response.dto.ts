import { ChatAttachmentResponseDto } from './chat-attachment-response.dto';
import { ChatAttachment } from '../entities/chat-attachment.entity';
import {
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus,
} from '../entities/chat-message.entity';

export class ChatMessageResponseDto {
  id: number;
  chatId: number;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  errorMessage: string | null;
  attachments: ChatAttachmentResponseDto[];
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(
    message: ChatMessage,
    attachments: ChatAttachment[] = [],
  ): ChatMessageResponseDto {
    return {
      id: message.id,
      chatId: message.chatId,
      role: message.role,
      content: message.content,
      status: message.status,
      errorMessage: message.errorMessage,
      attachments: attachments.map(ChatAttachmentResponseDto.fromEntity),
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }
}
