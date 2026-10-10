import { bearer, bridgeFetch, readOptionalJson } from './bridgeHttp.js';

// A file can be several MB.
const ATTACHMENT_TIMEOUT_MS = 60_000;

// A file the user attached to a message — fetched with ChatBridgeClient.downloadAttachment.
export interface ChatHistoryAttachment {
  id: number;
  name: string;
  size: number;
  isImage: boolean;
}

export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatHistoryAttachment[];
}

export interface ClaimedChatTurn {
  messageId: number;
  chatId: number;
  model: 'sonnet' | 'opus' | 'gpt' | 'deepseek' | 'qwen';
  history: ChatHistoryEntry[];
}

// Same auth shape as WorkerBridgeClient (a single personal API key, no
// refresh-token dance) — kept as its own small client rather than folded
// into WorkerBridgeClient, since chat is a deliberately separate module
// from Worker jobs end to end.
export class ChatBridgeClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}

  private post(path: string, what: string, body: unknown, includeBody = false): Promise<Response> {
    return bridgeFetch(
      `${this.apiUrl}/api/v1/chat/turns${path}`,
      { method: 'POST', headers: bearer(this.apiKey, true), body: JSON.stringify(body) },
      { expectOk: what, includeBody },
    );
  }

  // Returns null when nothing is pending right now (see readOptionalJson).
  async claim(): Promise<ClaimedChatTurn | null> {
    return readOptionalJson<ClaimedChatTurn>(await this.post('/claim', 'Chat claim', {}, true));
  }

  // The bytes of one file in a turn's history (bridge refuses any file that is not part of
  // the chat the message belongs to).
  async downloadAttachment(messageId: number, attachmentId: number): Promise<Buffer> {
    const response = await bridgeFetch(
      `${this.apiUrl}/api/v1/chat/turns/${messageId}/attachments/${attachmentId}`,
      { headers: bearer(this.apiKey) },
      { timeoutMs: ATTACHMENT_TIMEOUT_MS, expectOk: `Downloading attachment ${attachmentId}` },
    );

    return Buffer.from(await response.arrayBuffer());
  }

  async complete(messageId: number, content: string): Promise<void> {
    await this.post(`/${messageId}/complete`, `Completing chat turn ${messageId}`, { content });
  }

  async fail(messageId: number, errorMessage: string): Promise<void> {
    await this.post(`/${messageId}/fail`, `Failing chat turn ${messageId}`, { errorMessage });
  }
}
