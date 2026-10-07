export const MAX_FAILURE_OUTPUT_CHARS = 500;

// The job's errorMessage is all the Worker page shows for a failure, and the
// streamed log is batched/best-effort — so carry the tail of the model's
// output (where the real cause usually is) along with the exit code.
export function buildExitFailureMessage(exitCode: number, output: string): string {
  const base = `Model run exited with code ${exitCode}`;
  const trimmed = output.trim();
  if (!trimmed) return base;
  const tail = trimmed.length > MAX_FAILURE_OUTPUT_CHARS ? trimmed.slice(-MAX_FAILURE_OUTPUT_CHARS).trim() : trimmed;
  return `${base}: ${tail}`;
}
