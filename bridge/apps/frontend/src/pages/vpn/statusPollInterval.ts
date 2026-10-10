export const STATUS_POLL_INTERVAL_MS = 15000;
export const STATUS_POLL_FAILING_INTERVAL_MS = 60000;

// A failure like an expired panel certificate can't fix itself, so re-asking every 15 s only adds load and log rows.
export function nextPollInterval(lastRequestFailed: boolean): number {
  return lastRequestFailed ? STATUS_POLL_FAILING_INTERVAL_MS : STATUS_POLL_INTERVAL_MS;
}
