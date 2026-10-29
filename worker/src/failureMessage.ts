export const MAX_FAILURE_OUTPUT_CHARS = 500;

// The job's errorMessage is all the Worker page shows for a failure, and the
// streamed log is batched/best-effort — so carry the tail of the model's
// output (where the real cause usually is) along with the exit code.
// undici's "fetch failed" TypeError or a timeout: bridge or the AI endpoint could not be reached, which says nothing about the task.
export function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (error instanceof TypeError && error.message === 'fetch failed') || error.name === 'TimeoutError';
}

const MAX_CAUSE_DEPTH = 4;

function describeOne(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && code && !error.message.includes(code)) {
    return error.message ? `${error.message} [${code}]` : code;
  }
  return error.message || error.name;
}

// undici keeps the real reason (DNS, refused connection, proxy status) in `error.cause`, so
// a bare "fetch failed" says nothing; walk the chain, bounded and cycle-safe.
export function describeFailure(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (parts.length <= MAX_CAUSE_DEPTH && current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    parts.push(describeOne(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  const [head, ...causes] = parts;
  const text = causes.length ? `${head} (caused by: ${causes.join(' <- ')})` : head;
  return text.length > MAX_FAILURE_OUTPUT_CHARS ? `${text.slice(0, MAX_FAILURE_OUTPUT_CHARS - 1)}…` : text;
}

export function buildExitFailureMessage(exitCode: number, output: string): string {
  const base = `Model run exited with code ${exitCode}`;
  const trimmed = output.trim();
  if (!trimmed) return base;
  const tail = trimmed.length > MAX_FAILURE_OUTPUT_CHARS ? trimmed.slice(-MAX_FAILURE_OUTPUT_CHARS).trim() : trimmed;
  return `${base}: ${tail}`;
}
