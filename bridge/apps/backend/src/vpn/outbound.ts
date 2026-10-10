// Upper bound on any single outbound request (VPN panel or GitHub), so a
// hung upstream can't hold a backend connection open indefinitely.
export const OUTBOUND_FETCH_TIMEOUT_MS = 10_000;

export function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}
