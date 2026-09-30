import type { ChatHistoryEntry } from './anthropicChat.js';

export interface OpenAiCompatibleChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// The chat counterpart to modelRunners/openAiCompatibleRunner.ts — same
// OpenAI-compatible Chat Completions endpoint, but no `tools`/tool loop:
// one request, one response, since chat has no files to read or write.
export async function openAiCompatibleChat(
  history: ChatHistoryEntry[],
  options: OpenAiCompatibleChatOptions,
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
  });

  if (!response.ok) {
    throw new Error(`${options.model} API error (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content?: string | null } }[];
  };

  return data.choices[0]?.message.content ?? '';
}
