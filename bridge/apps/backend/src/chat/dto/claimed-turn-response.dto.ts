import { ClaimedProviderDto } from '../../worker/dto/provider-credential-response.dto';
import { ChatModel } from '../entities/chat.entity';
import { ChatMessageRole } from '../entities/chat-message.entity';

export interface ClaimedTurnAttachment {
  id: number;
  name: string;
  size: number;
  isImage: boolean;
}

export interface ClaimedTurnHistoryEntry {
  role: ChatMessageRole;
  content: string;
  // Files attached to this message, which the worker downloads (one request each) and
  // puts where Claude can read them. Absent when there are none.
  attachments?: ClaimedTurnAttachment[];
}

export class ClaimedTurnResponseDto {
  messageId: number;
  chatId: number;
  model: ChatModel;
  // The stored API key for a gpt/deepseek/qwen turn (the account's first one for that provider); null when there is
  // none — the worker then falls back to its own environment.
  provider: ClaimedProviderDto | null;
  // Every message in the chat up to and including the user message this
  // pending reply answers — worker is stateless between turns, so it needs
  // full context each time, not just the latest message.
  history: ClaimedTurnHistoryEntry[];
}
