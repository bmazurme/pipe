import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { resolveInDir } from "@pipe/protocol/resolveInDir";

import { CancelledError } from "../cancelled.js";
import { EXCLUDED_RESULT_DIRS, listFilesRecursively } from "../fsWalk.js";
import { completionHeaders, completionTimeoutMs, routeFor } from "../openAiRequest.js";
import { resolveDispatcher } from "../proxyAgent.js";
import type { OpenAiCompatibleConfig } from "../providers.js";
import type { RunResult } from "./claudeRunner.js";

const MAX_TURNS = 20;

const TURN_RETRY_DELAY_MS = 2000;

// Resolves after `ms`, or as soon as any of `signals` aborts.
function sleepUnlessAborted(ms: number, signals: AbortSignal[]): Promise<void> {
  return new Promise((resolve) => {
    const all = AbortSignal.any(signals);
    if (all.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      all.removeEventListener("abort", done);
      resolve();
    }
    all.addEventListener("abort", done);
  });
}

// A read_file result is pushed into `messages` and re-sent on every later
// turn, so one huge file (e.g. a lockfile) could overflow the context window.
export const MAX_TOOL_RESULT_CHARS = 50_000;

// A project can hold thousands of files: listing them all in one answer is tens of thousands of tokens, more than a local model's
// context and a waste on a paid one. The list is cut here and the model is told how to narrow it.
export const MAX_LIST_CHARS = 6_000;

const SYSTEM_PROMPT = [
  "You are a coding agent working in a plain directory (not a git repository).",
  "Use the read_file/list_files/write_file tools to inspect and edit files as needed.",
  "There is no shell/run_command tool available — make changes purely by reading and writing files.",
  "When you are done, reply with a plain text summary of what you changed and stop calling tools.",
].join(" ");

// A small model often stops without having changed anything: it shows the fix as a code block instead of writing it, or lists a directory,
// says so and ends. One reminder is sent when a run ends with no file written; an answer that says plainly there is nothing to change
// ("NO CHANGE: …") is left alone, so a task that needs no edit costs at most one extra request.
export const APPLY_REMINDER =
  'No file has been written yet. If the task needs a change, carry on: read the files that matter and apply the change by calling write_file with the full new content of each file you change — do not paste code in your reply. If nothing needs to change, reply with one sentence that starts with "NO CHANGE:" and says why.';

export function needsApplyReminder(content: string | null | undefined): boolean {
  return !/^\s*NO CHANGE\b/.test(content ?? "");
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: `List the file paths in the working directory, recursively, sorted. Output is capped at about ${MAX_LIST_CHARS} characters: pass a directory in path to list just that part.`,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "A directory to list, relative to the working directory (default: the whole directory).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: `Read a file as UTF-8 text. Output is capped at ${MAX_TOOL_RESULT_CHARS} characters; use offset to read further.`,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path relative to the working directory",
          },
          offset: {
            type: "integer",
            description: "Character offset to start reading from (default 0)",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or overwrite a file with the given UTF-8 text content.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path relative to the working directory",
          },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
] as const;

interface ToolCall {
  id: string;
  type?: "function";
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

const TOOL_NAMES = new Set<string>(TOOLS.map((tool) => tool.function.name));

// Some models (Qwen-coder variants on Ollama among them) print the call as text instead of returning `tool_calls`:
// the whole reply is one JSON object `{"name": …, "arguments": {…}}`, bare, in a ``` fence or inside <tool_call> tags. Without
// this the first such reply would end the job "successfully" with nothing done. Only a reply that is entirely such an object,
// naming one of our tools, counts — prose that merely mentions a tool is never executed.
export function parseTextToolCall(content: string | null | undefined): { name: string; arguments: string } | null {
  if (!content) return null;

  let text = content.trim();
  const tagged = /^<tool_call>\s*([\s\S]*?)\s*<\/tool_call>$/.exec(text);
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);

  text = (tagged ?? fenced)?.[1] ?? text;

  try {
    const parsed: unknown = JSON.parse(text);

    if (!parsed || typeof parsed !== "object") return null;

    const { name, arguments: args } = parsed as { name?: unknown; arguments?: unknown };

    if (typeof name !== "string" || !TOOL_NAMES.has(name)) return null;
    if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) return null;

    return { name, arguments: JSON.stringify(args ?? {}) };
  } catch {
    return null;
  }
}

// The file paths under `directory` (all of them when empty), sorted, cut after MAX_LIST_CHARS with a note that says how many were left.
export function listFilesCapped(cwd: string, directory: string): string {
  const base = directory.trim() === "" || directory.trim() === "." ? cwd : resolveInDir(cwd, directory.trim());
  const paths = listFilesRecursively(base, cwd, EXCLUDED_RESULT_DIRS).sort();

  if (paths.length === 0) return directory.trim() ? `(no files under ${directory.trim()})` : "(no files)";

  const shown: string[] = [];
  let size = 0;

  for (const path of paths) {
    if (size + path.length + 1 > MAX_LIST_CHARS && shown.length > 0) break;
    shown.push(path);
    size += path.length + 1;
  }

  const left = paths.length - shown.length;

  return left === 0
    ? shown.join("\n")
    : `${shown.join("\n")}\n[${left} more of ${paths.length} files not shown: call list_files with a path to list one directory]`;
}

// Keeps log lines bounded — write_file's arguments carry the entire file
// content, which would otherwise be copied in full into the job's log row.
function truncate(text: string, max = 200): string {
  return text.length > max
    ? `${text.slice(0, max)}…(+${text.length - max} chars)`
    : text;
}

export function executeTool(
  cwd: string,
  name: string,
  args: Record<string, unknown>,
): string {
  switch (name) {
    case "list_files": {
      return listFilesCapped(cwd, typeof args.path === "string" ? args.path : "");
    }
    case "read_file": {
      const path = resolveInDir(cwd, String(args.path ?? ""));
      const content = readFileSync(path, "utf-8");
      const offset = Math.max(0, Math.floor(Number(args.offset ?? 0)) || 0);
      const slice = content.slice(offset, offset + MAX_TOOL_RESULT_CHARS);
      if (offset === 0 && content.length <= MAX_TOOL_RESULT_CHARS) {
        return content;
      }
      if (offset + slice.length >= content.length) {
        return slice;
      }
      return `${slice}\n[truncated: file has ${content.length} chars; ${slice.length} shown from offset ${offset}. Pass offset=${offset + slice.length} to read more]`;
    }
    case "write_file": {
      const path = resolveInDir(cwd, String(args.path ?? ""));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, String(args.content ?? ""), "utf-8");
      return "ok";
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// Generous on purpose — a real completion (especially with tool calls) can legitimately take minutes (openAiRequest.ts has the
// default and the per-key override); without any bound a provider that just hangs would block the job forever.
export type OpenAiCompatibleOptions = Pick<
  OpenAiCompatibleConfig,
  "baseUrl" | "apiKey" | "model" | "route" | "authScheme" | "extraHeaders" | "timeoutSec" | "priceInPerMTok" | "priceOutPerMTok"
>;

// What the servers report per completion (`usage`), summed over the run; null when none ever did.
export function usageReport(
  tokens: { input: number; output: number } | null,
  prices: Pick<OpenAiCompatibleConfig, "priceInPerMTok" | "priceOutPerMTok">,
): RunResult["report"] | undefined {
  if (!tokens) return undefined;

  const priced = prices.priceInPerMTok !== undefined || prices.priceOutPerMTok !== undefined;
  const costUsd = priced ? (tokens.input * (prices.priceInPerMTok ?? 0) + tokens.output * (prices.priceOutPerMTok ?? 0)) / 1_000_000 : null;

  return { usage: { costUsd, inputTokens: tokens.input, outputTokens: tokens.output, cacheReadTokens: 0, cacheCreationTokens: 0 } };
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
  timeoutMs?: number,
  signal?: AbortSignal,
  retryDelayMs = TURN_RETRY_DELAY_MS,
): Promise<RunResult> {
  const timeoutError = () =>
    new Error(
      `${options.model} job timed out after ${(timeoutMs ?? 0) / 1000}s`,
    );
  const deadlineSignal =
    timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);

  // Decided once per job: the key's route against the proxy this worker has right now. A run keeps its route to the end.
  const route = routeFor(options, proxyUrl);
  const headers = completionHeaders(options);
  const completionTimeout = completionTimeoutMs(options);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  let output = "";
  let anyToolCall = false;
  let wroteFile = false;
  let reminded = false;
  const total = { input: 0, output: 0, reported: false };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal?.aborted) throw new CancelledError();
    if (deadlineSignal?.aborted) throw timeoutError();

    let data: { choices?: { message?: ChatMessage }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    for (let attempt = 0; ; attempt++) {
      const completionSignal = AbortSignal.timeout(completionTimeout);
      let retryable = false;
      try {
        const response = await fetch(`${options.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: options.model,
            messages,
            tools: TOOLS,
            tool_choice: "auto",
          }),
          // `dispatcher` is a Node/undici-specific fetch extension not in the
          // standard RequestInit type — real at runtime, just untyped here.
          dispatcher: resolveDispatcher(route.proxyUrl),
          signal: AbortSignal.any([
            completionSignal,
            ...(deadlineSignal ? [deadlineSignal] : []),
            ...(signal ? [signal] : []),
          ]),
        } as RequestInit);

        if (!response.ok) {
          retryable = response.status === 429 || response.status >= 500;
          throw new Error(
            `${options.model} API error (${response.status}): ${await response.text()}`,
          );
        }

        data = (await response.json()) as typeof data;
        break;
      } catch (error) {
        // The owner's stop wins over everything else; then only the job deadline is
        // rewritten — a per-request timeout keeps its own message.
        if (signal?.aborted) throw new CancelledError();
        if (deadlineSignal?.aborted) throw timeoutError();
        if (error instanceof TypeError) retryable = true;
        // One retry of the same turn on a network blip, 429 or 5xx; nothing was appended to `messages`.
        if (!retryable || attempt >= 1) throw error;
        onOutput(
          `retrying ${options.model} turn after: ${(error as Error).message}\n`,
        );
        await sleepUnlessAborted(retryDelayMs, [
          ...(deadlineSignal ? [deadlineSignal] : []),
          ...(signal ? [signal] : []),
        ]);
        if (signal?.aborted) throw new CancelledError();
        if (deadlineSignal?.aborted) throw timeoutError();
      }
    }
    // Counted as the server says; a server that sends no usage leaves the run without a report (nothing is made up).
    if (typeof data.usage?.prompt_tokens === "number" || typeof data.usage?.completion_tokens === "number") {
      total.reported = true;
      total.input += Math.max(0, data.usage?.prompt_tokens ?? 0);
      total.output += Math.max(0, data.usage?.completion_tokens ?? 0);
    }

    const message = data.choices?.[0]?.message;

    if (!message) {
      throw new Error(`${options.model} returned no message`);
    }

    // A call printed as text becomes a real one, so the rest of the loop (and the transcript the model sees) is the normal shape.
    const textCall = message.tool_calls?.length ? null : parseTextToolCall(message.content);

    if (textCall) {
      message.content = null;
      message.tool_calls = [{ id: `text-call-${turn}`, type: "function", function: textCall }];
      onOutput(`(the model printed a call to ${textCall.name} as text — treated as a tool call)\n`);
    }

    messages.push(message);

    if (message.content) {
      output += message.content + "\n";
      onOutput(message.content + "\n");
    }

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      if (!wroteFile && !reminded && needsApplyReminder(message.content)) {
        reminded = true;
        onOutput("(no file was written — reminding the model to apply the change)\n");
        messages.push({ role: "user", content: APPLY_REMINDER });
        continue;
      }

      if (!anyToolCall) {
        onOutput("Warning: the model never called a tool, so no file was read or changed — it may not support function calling.\n");
      }
      return { exitCode: 0, output, report: usageReport(total.reported ? total : null, options) };
    }
    anyToolCall = true;

    for (const call of toolCalls) {
      let result: string;
      try {
        const args = call.function.arguments
          ? JSON.parse(call.function.arguments)
          : {};
        result = executeTool(cwd, call.function.name, args);
        if (call.function.name === "write_file") wroteFile = true;
      } catch (error) {
        result = `Error: ${(error as Error).message}`;
      }

      onOutput(
        `[tool] ${call.function.name}(${truncate(call.function.arguments)}) -> ${truncate(result)}\n`,
      );
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  onOutput(
    `Stopped after ${MAX_TURNS} turns without the model signaling completion.\n`,
  );
  return { exitCode: 1, output, report: usageReport(total.reported ? total : null, options) };
}
