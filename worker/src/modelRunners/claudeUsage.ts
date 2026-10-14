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
export class ClaudeStreamParser {
  readonly report: ClaudeReport = {};
  /** The final reply, from the CLI's own `result` event, when it sent one. */
  finalText: string | null = null;
  private buffer = '';

  constructor(private readonly onText: (text: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;

    let newline = this.buffer.indexOf('\n');

    while (newline >= 0) {
      this.line(this.buffer.slice(0, newline));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
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

    if (event.type === 'rate_limit_event') {
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
