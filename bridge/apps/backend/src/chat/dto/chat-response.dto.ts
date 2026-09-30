import { Chat, ChatModel } from '../entities/chat.entity';

export class ChatResponseDto {
  id: number;
  model: ChatModel;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(chat: Chat): ChatResponseDto {
    return {
      id: chat.id,
      model: chat.model,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    };
  }
}
