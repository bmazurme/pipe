import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { listFilesRecursively } from '../fsWalk.js';
import { resolveDispatcher } from '../proxyAgent.js';
import { resolveInDir } from '../resolveInDir.js';
import type { RunResult } from './claudeRunner.js';

const MAX_TURNS = 20;

// Generous on purpose — a real completion (especially with tool calls) can
// legitimately take minutes, unlike a plain API round trip. Without any
// timeout at all, a provider that just hangs would block the job forever.
const COMPLETION_TIMEOUT_MS = 300_000;

const SYSTEM_PROMPT = [
  'You are a coding agent working in a plain directory (not a git repository).',
  'Use the read_file/list_files/write_file tools to inspect and edit files as needed.',
  'There is no shell/run_command tool available — make changes purely by reading and writing files.',
  'When you are done, reply with a plain text summary of what you changed and stop calling tools.',
].join(' ');

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List every file path in the working directory, recursively.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file\'s full contents as UTF-8 text.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path relative to the working directory' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file with the given UTF-8 text content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the working directory' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
] as const;

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

const resolveInWorkDir = resolveInDir;

function executeTool(cwd: string, name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'list_files': {
      return listFilesRecursively(cwd).join('\n');
    }
    case 'read_file': {
      const path = resolveInWorkDir(cwd, String(args.path ?? ''));
      return readFileSync(path, 'utf-8');
    }
    case 'write_file': {
      const path = resolveInWorkDir(cwd, String(args.path ?? ''));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, String(args.content ?? ''), 'utf-8');
      return 'ok';
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// The minimal agent loop shared by gpt/deepseek/qwen: all three expose the
// same OpenAI-compatible Chat Completions + function-calling shape, so one
// implementation covers all of them, parameterized only by baseUrl/apiKey/
// model. Deliberately no shell/run_command tool (unlike claude CLI's own
// trusted, already-accepted --dangerously-skip-permissions posture) — this
// only ever reads and writes files.
export async function runOpenAiCompatible(
  cwd: string,
  prompt: string,
  options: OpenAiCompatibleOptions,
  onOutput: (chunk: string) => void,
  proxyUrl?: string,
): Promise<RunResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];

  let output = '';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await fetch(`${options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
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
      choices?: { message?: ChatMessage }[];
    };
    const message = data.choices?.[0]?.message;

    if (!message) {
      throw new Error(`${options.model} returned no message`);
    }

    messages.push(message);

    if (message.content) {
      output += message.content + '\n';
      onOutput(message.content + '\n');
    }

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { exitCode: 0, output };
    }

    for (const call of toolCalls) {
      let result: string;
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        result = executeTool(cwd, call.function.name, args);
      } catch (error) {
        result = `Error: ${(error as Error).message}`;
      }

      onOutput(`[tool] ${call.function.name}(${call.function.arguments}) -> ${result.slice(0, 200)}\n`);
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }

  onOutput(`Stopped after ${MAX_TURNS} turns without the model signaling completion.\n`);
  return { exitCode: 1, output };
}
