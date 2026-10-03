// Same reasoning as bridgeClient.ts's own API_TIMEOUT_MS — claim() runs in
// the same poll loop, so a hung request here would freeze it just as badly.
const API_TIMEOUT_MS = 15_000;

export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
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

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  // Returns null when nothing is pending right now — bridge sends an empty
  // body for that case (204 is the current behavior; an older deployment
  // may still send 201 with no body), never a 200 with JSON "null".
  // response.json() throws on an empty body ("Unexpected end of JSON
  // input"), so this checks the raw text first rather than assuming a
  // specific status code — robust either way, and to bridge deployments
  // that haven't picked up the 204 fix yet.
  async claim(): Promise<ClaimedChatTurn | null> {
    const response = await fetch(`${this.apiUrl}/api/v1/chat/turns/claim`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: '{}',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Chat claim failed (${response.status}): ${await response.text()}`);
    }

    const text = await response.text();
    return text ? (JSON.parse(text) as ClaimedChatTurn | null) : null;
  }

  async complete(messageId: number, content: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/v1/chat/turns/${messageId}/complete`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Completing chat turn ${messageId} failed (${response.status})`);
    }
  }

  async fail(messageId: number, errorMessage: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/v1/chat/turns/${messageId}/fail`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ errorMessage }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Failing chat turn ${messageId} failed (${response.status})`);
    }
  }
}
