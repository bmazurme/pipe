import type { StreamDelta } from '../modelRunners/claudeUsage.js';

const MAX_THINKING_CHARS = 1500;

// The text a chat shows for a reply that is still being written: the reasoning the model chose to show (quoted, only its
// tail — it can be long), then the answer so far.
export function renderProgress(thinking: string, answer: string): string {
  const reasoning = thinking.trim()
    ? `> 💭 ${thinking.trim().slice(-MAX_THINKING_CHARS).replace(/\n+/g, '\n> ')}\n\n`
    : '';

  return `${reasoning}${answer}`.trimEnd();
}

export interface ProgressReporter {
  push: (delta: StreamDelta) => void;
  /** No more reports (the turn ended): a pending one is dropped, since the final reply follows. */
  stop: () => void;
}

// Collects the deltas and sends the whole text so far at most once per `intervalMs`, always the latest — a lost or skipped
// report costs nothing because the next one carries everything. Never throws into the run.
export function createProgressReporter(
  send: (text: string) => void | Promise<void>,
  intervalMs = 1500,
): ProgressReporter {
  let thinking = '';
  let answer = '';
  let timer: NodeJS.Timeout | undefined;
  let lastSent = '';
  let stopped = false;

  const flush = () => {
    timer = undefined;

    const text = renderProgress(thinking, answer);

    if (stopped || !text || text === lastSent) return;

    lastSent = text;
    try {
      void Promise.resolve(send(text)).catch(() => undefined);
    } catch {
      // best-effort
    }
  };

  return {
    push(delta) {
      if (stopped) return;

      if (delta.kind === 'thinking') thinking += delta.text;
      else answer += delta.text;

      // The first words go out at once — that is the moment the loader stops being the only sign of life.
      if (!timer) timer = setTimeout(flush, lastSent === '' ? 0 : intervalMs);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
