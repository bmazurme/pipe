export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicChatOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens?: number;
}

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

// One request, one response — no tool use, no working directory. Worker
// sends the full history every turn (it keeps no state between turns; bridge
// is the source of truth for conversation history).
export async function anthropicChat(history: ChatHistoryEntry[], options: AnthropicChatOptions): Promise<string> {
  const response = await fetch(`${options.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': options.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: history.map((entry) => ({ role: entry.role, content: entry.content })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as {
    content: { type: string; text?: string }[];
  };

  return data.content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');
}
