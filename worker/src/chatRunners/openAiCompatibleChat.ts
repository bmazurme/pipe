import type { ChatHistoryEntry } from '../chatBridgeClient.js';
import { CHAT_TOOLS_SYSTEM_PROMPT, type ChatToolset } from '../chatTools.js';
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

// A chat turn can call a few bridge-native read tools (see chatTools.ts) — a short
// loop, far below the job runner's 20 turns: a question about jobs needs one or
// two lookups, and anything longer is a model going in circles.
const MAX_TOOL_ROUNDS = 5;

interface ChatCompletionMessage {
  role: string;
  content?: string | null;
  tool_calls?: { id: string; type?: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

// The chat counterpart to modelRunners/openAiCompatibleRunner.ts — same
// OpenAI-compatible Chat Completions endpoint. Without `toolset` it is one
// request, one response (chat has no files). With one, the model may call its
// tools before answering.
export async function openAiCompatibleChat(
  history: ChatHistoryEntry[],
  options: OpenAiCompatibleChatOptions,
  proxyUrl?: string,
  toolset?: ChatToolset | null,
): Promise<string> {
  const messages: ChatCompletionMessage[] = [
    ...(toolset ? [{ role: 'system', content: CHAT_TOOLS_SYSTEM_PROMPT }] : []),
    ...history.map((entry) => ({ role: entry.role, content: entry.content })),
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // After the last allowed round the tools are withheld, forcing a plain answer.
    const withTools = toolset && round < MAX_TOOL_ROUNDS;

    const response = await fetch(`${options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        ...(withTools ? { tools: toolset.definitions, tool_choice: 'auto' } : {}),
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
      choices?: { message?: ChatCompletionMessage }[];
    };
    const message = data.choices?.[0]?.message;
    const toolCalls = message?.tool_calls ?? [];

    if (withTools && toolCalls.length > 0) {
      messages.push(message as ChatCompletionMessage);

      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};

        try {
          args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
        } catch {
          // A malformed argument string is reported back to the model as an error result.
        }

        messages.push({ role: 'tool', tool_call_id: call.id, content: await toolset.execute(call.function.name, args) });
      }

      continue;
    }

    const content = message?.content;
    if (!content || !content.trim()) {
      throw new Error(`${options.model} returned an empty reply`);
    }

    return content;
  }

  throw new Error(`${options.model} kept calling tools without answering`);
}
