import type { ChatHistoryEntry } from '../chatBridgeClient.js';
import { CHAT_ACTIONS_INSTRUCTION } from './chatActions.js';
import { CHAT_TOOLS_SYSTEM_PROMPT, type ChatToolset } from '../chatTools.js';
import { withContext } from '../taskContext.js';
import type { StreamDelta } from '../modelRunners/claudeUsage.js';
import { createProgressReporter } from './progress.js';
import { completionHeaders, completionTimeoutMs, routeFor } from '../openAiRequest.js';
import { resolveDispatcher } from '../proxyAgent.js';
import type { OpenAiCompatibleConfig } from '../providers.js';

// Same bound as modelRunners/openAiCompatibleRunner.ts (openAiRequest.ts): generous since a real completion can take minutes, but
// still bounded so a hung provider doesn't block the chat turn forever.
export type OpenAiCompatibleChatOptions = Pick<
  OpenAiCompatibleConfig,
  'baseUrl' | 'apiKey' | 'model' | 'route' | 'authScheme' | 'extraHeaders' | 'timeoutSec' | 'stream'
>;

// Reads a server-sent-events stream of chat completion chunks (`data: {...}` lines, `data: [DONE]` at the end) and reports each
// piece of text as it arrives: the answer (`delta.content`) and, for servers that send it, the reasoning
// (`delta.reasoning_content`). Lines can be split across network chunks; comments, blank lines and chunks that are not JSON are skipped.
export async function readCompletionStream(body: ReadableStream<Uint8Array>, onDelta: (delta: StreamDelta) => void): Promise<void> {
  const decoder = new TextDecoder();
  let buffered = '';

  const handleLine = (raw: string) => {
    const line = raw.trim();

    if (!line.startsWith('data:')) return;

    const payload = line.slice(5).trim();

    if (payload === '' || payload === '[DONE]') return;

    try {
      const delta = (JSON.parse(payload) as { choices?: { delta?: { content?: string | null; reasoning_content?: string | null } }[] }).choices?.[0]?.delta;

      if (delta?.reasoning_content) onDelta({ kind: 'thinking', text: delta.reasoning_content });
      if (delta?.content) onDelta({ kind: 'text', text: delta.content });
    } catch {
      // a keep-alive or a chunk this reader does not know: nothing to show
    }
  };

  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffered += decoder.decode(chunk, { stream: true });

    const lines = buffered.split('\n');

    buffered = lines.pop() ?? '';
    lines.forEach(handleLine);
  }

  handleLine(buffered + decoder.decode());
}

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
  // Background text from the Context attached to the chat; absent or blank: the system message is unchanged.
  context?: string | null,
  // Hears the answer as the model writes it (streaming keys only); used to show progress in the chat.
  onProgress?: (text: string) => void | Promise<void>,
): Promise<string> {
  const instructions = toolset ? `${CHAT_TOOLS_SYSTEM_PROMPT}\n\n${CHAT_ACTIONS_INSTRUCTION}` : CHAT_ACTIONS_INSTRUCTION;
  const contextBlock = withContext('', context).trim();
  const messages: ChatCompletionMessage[] = [
    {
      role: 'system',
      content: contextBlock ? `${instructions}\n\n${contextBlock}` : instructions,
    },
    ...history.map((entry) => ({ role: entry.role, content: entry.content })),
  ];

  const route = routeFor(options, proxyUrl);
  const headers = completionHeaders(options);
  const completionTimeout = completionTimeoutMs(options);

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // After the last allowed round the tools are withheld, forcing a plain answer.
    const withTools = toolset && round < MAX_TOOL_ROUNDS;

    // Only a plain answer is streamed: a round that may call tools needs the whole message to see the calls.
    const streaming = Boolean(options.stream && onProgress && !withTools);
    const response = await fetch(`${options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options.model,
        messages,
        ...(streaming ? { stream: true } : {}),
        ...(withTools ? { tools: toolset.definitions, tool_choice: 'auto' } : {}),
      }),
      // `dispatcher` is a Node/undici-specific fetch extension not in the
      // standard RequestInit type — real at runtime, just untyped here.
      dispatcher: resolveDispatcher(route.proxyUrl),
      signal: AbortSignal.timeout(completionTimeout),
    } as RequestInit);

    if (!response.ok) {
      throw new Error(`${options.model} API error (${response.status}): ${await response.text()}`);
    }

    // A server that ignores `stream` answers with plain JSON: handled below like any other reply.
    if (streaming && response.body && (response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const progress = createProgressReporter(onProgress as (text: string) => void | Promise<void>);
      let answer = '';

      try {
        await readCompletionStream(response.body, (delta) => {
          if (delta.kind === 'text') answer += delta.text;
          progress.push(delta);
        });
      } finally {
        progress.stop();
      }

      if (!answer.trim()) throw new Error(`${options.model} returned an empty reply`);

      return answer;
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
