// What the claude CLI reports about the account's plan limits and what a run cost, read from its
// `--output-format stream-json` events. Everything is best-effort: a CLI version that stops sending an
// event just leaves the field out — a run never fails because of it.
export interface ClaudeLimitWindow {
  /** 0..1 */
  utilization: number;
  /** Unix seconds */
  resetsAt: number | null;
}

export interface ClaudeLimits {
  status: string;
  /** Which window the CLI flagged: five_hour, seven_day, … */
  rateLimitType: string | null;
  isUsingOverage: boolean;
  windows: Record<string, ClaudeLimitWindow>;
}

export interface ClaudeRunUsage {
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface ClaudeReport {
  limits?: ClaudeLimits;
  usage?: ClaudeRunUsage;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function parseLimits(info: unknown): ClaudeLimits | undefined {
  if (!isObject(info) || typeof info.status !== 'string') return undefined;

  const windows: Record<string, ClaudeLimitWindow> = {};
  const reported = isObject(info.unifiedWindows) ? info.unifiedWindows : {};

  for (const [name, value] of Object.entries(reported)) {
    const utilization = isObject(value) ? num(value.utilization) : null;

    if (utilization !== null) windows[name] = { utilization, resetsAt: num((value as Record<string, unknown>).resetsAt) };
  }

  // An event that names only its own window (no unifiedWindows) still tells us that one.
  const type = typeof info.rateLimitType === 'string' ? info.rateLimitType : null;
  const utilization = num(info.utilization);

  if (type && utilization !== null && !windows[type]) windows[type] = { utilization, resetsAt: num(info.resetsAt) };

  return { status: info.status, rateLimitType: type, isUsingOverage: info.isUsingOverage === true, windows };
}

export function parseUsage(result: Record<string, unknown>): ClaudeRunUsage | undefined {
  const usage = isObject(result.usage) ? result.usage : null;

  if (!usage) return undefined;

  return {
    costUsd: num(result.total_cost_usd),
    inputTokens: num(usage.input_tokens) ?? 0,
    outputTokens: num(usage.output_tokens) ?? 0,
    cacheReadTokens: num(usage.cache_read_input_tokens) ?? 0,
    cacheCreationTokens: num(usage.cache_creation_input_tokens) ?? 0,
  };
}

// Reads the CLI's stdout line by line. Text it can use (assistant replies) is passed to `onText`; a line that
// is not JSON at all is passed through unchanged, so a CLI that ignores the format flag, or an error printed
// as plain text, still ends up in the log exactly as before.
export interface StreamDelta {
  kind: 'text' | 'thinking';
  text: string;
}

/** How long a single stdout line may grow before the parser stops waiting for its newline. */
export const MAX_PENDING_LINE_CHARS = 8 * 1024 * 1024;

export class ClaudeStreamParser {
  readonly report: ClaudeReport = {};
  /** The final reply, from the CLI's own `result` event, when it sent one. */
  finalText: string | null = null;
  private buffer = '';

  // `onDelta` hears the reply (and any reasoning the model shows) as it is written — only with the CLI's
  // --include-partial-messages; it is what lets a chat show the answer growing instead of a bare loader.
  constructor(
    private readonly onText: (text: string) => void,
    private readonly onDelta?: (delta: StreamDelta) => void,
  ) {}

  // One pass per chunk: the newline search starts where the previous chunk ended (the pending partial line has
  // no newline in it), and the buffer is cut once — re-slicing it per line was quadratic with
  // --include-partial-messages (hundreds of short lines per chunk) and with a multi-megabyte tool-result line.
  push(chunk: string): void {
    const buffer = this.buffer + chunk;
    let start = 0;
    let newline = buffer.indexOf('\n', this.buffer.length);

    while (newline >= 0) {
      this.line(buffer.slice(start, newline));
      start = newline + 1;
      newline = buffer.indexOf('\n', start);
    }

    this.buffer = start > 0 ? buffer.slice(start) : buffer;

    // A runaway line is passed on as raw text, like any line that does not parse, instead of growing unbounded.
    if (this.buffer.length > MAX_PENDING_LINE_CHARS) {
      this.onText(`${this.buffer}\n`);
      this.buffer = '';
    }
  }

  end(): void {
    if (this.buffer.trim()) this.line(this.buffer);
    this.buffer = '';
  }

  private line(raw: string): void {
    const text = raw.trim();

    if (!text) return;

    let event: unknown;

    try {
      event = JSON.parse(text);
    } catch {
      this.onText(`${raw}\n`);

      return;
    }

    if (!isObject(event) || typeof event.type !== 'string') {
      this.onText(`${raw}\n`);

      return;
    }

    if (event.type === 'stream_event') {
      const inner = isObject(event.event) ? event.event : null;
      const delta = inner && inner.type === 'content_block_delta' && isObject(inner.delta) ? inner.delta : null;

      if (delta && delta.type === 'text_delta' && typeof delta.text === 'string') {
        this.onDelta?.({ kind: 'text', text: delta.text });
      } else if (delta && delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        this.onDelta?.({ kind: 'thinking', text: delta.thinking });
      }
    } else if (event.type === 'rate_limit_event') {
      this.report.limits = parseLimits(event.rate_limit_info) ?? this.report.limits;
    } else if (event.type === 'result') {
      this.report.usage = parseUsage(event) ?? this.report.usage;

      if (typeof event.result === 'string') this.finalText = event.result;
    } else if (event.type === 'assistant' && isObject(event.message) && Array.isArray(event.message.content)) {
      for (const block of event.message.content) {
        if (isObject(block) && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          this.onText(`${block.text}\n`);
        }
      }
    }
  }
}
