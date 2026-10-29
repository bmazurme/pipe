export const MAX_FAILURE_OUTPUT_CHARS = 500;

// The job's errorMessage is all the Worker page shows for a failure, and the
// streamed log is batched/best-effort — so carry the tail of the model's
// output (where the real cause usually is) along with the exit code.
// undici's "fetch failed" TypeError or a timeout: bridge or the AI endpoint could not be reached, which says nothing about the task.
export function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (error instanceof TypeError && error.message === 'fetch failed') || error.name === 'TimeoutError';
}

export function buildExitFailureMessage(exitCode: number, output: string): string {
  const base = `Model run exited with code ${exitCode}`;
  const trimmed = output.trim();
  if (!trimmed) return base;
  const tail = trimmed.length > MAX_FAILURE_OUTPUT_CHARS ? trimmed.slice(-MAX_FAILURE_OUTPUT_CHARS).trim() : trimmed;
  return `${base}: ${tail}`;
}
