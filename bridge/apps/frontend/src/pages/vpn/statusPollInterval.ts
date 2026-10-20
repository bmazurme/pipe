import { useCallback, useRef } from 'react';

export const STATUS_POLL_INTERVAL_MS = 15000;
export const STATUS_POLL_FAILING_INTERVAL_MS = 60000;

// A failure like an expired panel certificate can't fix itself, so re-asking every 15 s only adds load and log rows.
export function nextPollInterval(lastRequestFailed: boolean): number {
  return lastRequestFailed ? STATUS_POLL_FAILING_INTERVAL_MS : STATUS_POLL_INTERVAL_MS;
}

export interface SettledQueryState {
  isError: boolean;
  isSuccess: boolean;
  isFetching: boolean;
}

// The interval has to be known before the query it feeds exists, so this returns it together with a `track`
// callback to call with the query's result right after. isError drops back to false while a retry is in flight,
// so the last settled result is remembered instead; a change in it always comes with a re-render of the caller.
export function useFailureAwarePollInterval(
  okMs: number,
  failingMs: number,
): { intervalMs: number; track: (query: SettledQueryState) => void } {
  const lastRequestFailed = useRef(false);
  const track = useCallback((query: SettledQueryState) => {
    if (query.isError) lastRequestFailed.current = true;
    else if (query.isSuccess && !query.isFetching) lastRequestFailed.current = false;
  }, []);
  return { intervalMs: lastRequestFailed.current ? failingMs : okMs, track };
}
