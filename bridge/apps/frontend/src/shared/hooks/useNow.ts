import { useEffect, useState } from 'react';

// The current time, refreshed every `intervalMs` (0 = no refresh, the value stays as it was) — for a label that has to
// keep moving between data polls, such as the elapsed time of a running job.
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (intervalMs <= 0) return undefined;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
