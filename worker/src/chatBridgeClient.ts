import type { ChatHistoryEntry } from './chatRunners/anthropicChat.js';

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

  // Returns null when nothing is pending right now.
  async claim(): Promise<ClaimedChatTurn | null> {
    const response = await fetch(`${this.apiUrl}/api/v1/chat/turns/claim`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: '{}',
    });

    if (!response.ok) {
      throw new Error(`Chat claim failed (${response.status}): ${await response.text()}`);
    }

    return (await response.json()) as ClaimedChatTurn | null;
  }

  async complete(messageId: number, content: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/v1/chat/turns/${messageId}/complete`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ content }),
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
    });

    if (!response.ok) {
      throw new Error(`Failing chat turn ${messageId} failed (${response.status})`);
    }
  }
}
