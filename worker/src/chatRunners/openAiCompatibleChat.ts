import type { ChatHistoryEntry } from '../chatBridgeClient.js';
import { resolveDispatcher } from '../proxyAgent.js';

export interface OpenAiCompatibleChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// Same reasoning as modelRunners/openAiCompatibleRunner.ts's own
// COMPLETION_TIMEOUT_MS — generous since a real completion can take minutes,
// but still bounded so a hung provider doesn't block the chat turn forever.
const COMPLETION_TIMEOUT_MS = 300_000;

// The chat counterpart to modelRunners/openAiCompatibleRunner.ts — same
// OpenAI-compatible Chat Completions endpoint, but no `tools`/tool loop:
// one request, one response, since chat has no files to read or write.
export async function openAiCompatibleChat(
  history: ChatHistoryEntry[],
  options: OpenAiCompatibleChatOptions,
  proxyUrl?: string,
): Promise<string> {
  const response = await fetch(`${options.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      messages: history.map((entry) => ({ role: entry.role, content: entry.content })),
    }),
    // `dispatcher` is a Node/undici-specific fetch extension not in the
    // standard RequestInit type — real at runtime, just untyped here.
    dispatcher: resolveDispatcher(proxyUrl),
    signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS),
  } as RequestInit);

  if (!response.ok) {
    throw new Error(`${options.model} API error (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content?: string | null } }[];
  };

  return data.choices[0]?.message.content ?? '';
}
