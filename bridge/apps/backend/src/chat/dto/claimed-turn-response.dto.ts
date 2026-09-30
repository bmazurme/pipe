import { ChatModel } from '../entities/chat.entity';
import { ChatMessageRole } from '../entities/chat-message.entity';

export interface ClaimedTurnHistoryEntry {
  role: ChatMessageRole;
  content: string;
}

export class ClaimedTurnResponseDto {
  messageId: number;
  chatId: number;
  model: ChatModel;
  // Every message in the chat up to and including the user message this
  // pending reply answers — worker is stateless between turns, so it needs
  // full context each time, not just the latest message.
  history: ClaimedTurnHistoryEntry[];
}
