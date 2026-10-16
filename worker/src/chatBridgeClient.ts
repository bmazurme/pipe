import { bearer, bridgeFetch, readOptionalJson, reportClaudeUsage } from './bridgeHttp.js';
import type { ClaudeReport } from './modelRunners/claudeUsage.js';

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
  // The account's Claude token for a sonnet/opus turn (null/absent: this process's own login).
  claudeToken?: string | null;
  // The stored API key for a gpt/deepseek/qwen turn; null/absent = this worker's own environment.
  provider?: { apiKey: string; baseUrl?: string | null; model?: string | null } | null;
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

  // The plan limits the claude CLI reported for this turn; never throws.
  reportClaudeUsage(report: ClaudeReport): Promise<void> {
    return reportClaudeUsage(this.apiUrl, this.apiKey, report);
  }

  // The reply so far, for the chat page to show while the turn runs. Best-effort: a failed report is just a missed update.
  async reportProgress(messageId: number, text: string): Promise<void> {
    try {
      await this.post(`/${messageId}/progress`, `Reporting progress of chat turn ${messageId}`, { text });
    } catch {
      // the final reply goes through complete()
    }
  }

  async complete(messageId: number, content: string): Promise<void> {
    await this.post(`/${messageId}/complete`, `Completing chat turn ${messageId}`, { content });
  }

  async fail(messageId: number, errorMessage: string): Promise<void> {
    await this.post(`/${messageId}/fail`, `Failing chat turn ${messageId}`, { errorMessage });
  }
}
