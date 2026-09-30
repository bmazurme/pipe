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
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(message: ChatMessage): ChatMessageResponseDto {
    return {
      id: message.id,
      chatId: message.chatId,
      role: message.role,
      content: message.content,
      status: message.status,
      errorMessage: message.errorMessage,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }
}
