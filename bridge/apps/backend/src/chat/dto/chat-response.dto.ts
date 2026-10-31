import { Chat, ChatModel } from '../entities/chat.entity';

export class ChatResponseDto {
  id: number;
  model: ChatModel;
  // The key a custom chat runs on, or null.
  providerCredentialId: number | null;
  title: string | null;
  contextName: string | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(chat: Chat): ChatResponseDto {
    return {
      id: chat.id,
      model: chat.model,
      providerCredentialId: chat.providerCredentialId ?? null,
      title: chat.title,
      contextName: chat.contextName ?? null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    };
  }
}
