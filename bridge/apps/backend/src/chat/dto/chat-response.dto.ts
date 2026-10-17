import { Chat, ChatModel } from '../entities/chat.entity';

export class ChatResponseDto {
  id: number;
  model: ChatModel;
  title: string | null;
  contextName: string | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(chat: Chat): ChatResponseDto {
    return {
      id: chat.id,
      model: chat.model,
      title: chat.title,
      contextName: chat.contextName ?? null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    };
  }
}
