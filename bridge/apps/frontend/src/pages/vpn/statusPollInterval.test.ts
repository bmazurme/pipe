import { describe, expect, it } from 'vitest';

import { nextPollInterval, STATUS_POLL_FAILING_INTERVAL_MS, STATUS_POLL_INTERVAL_MS } from './statusPollInterval';

describe('nextPollInterval', () => {
  it('polls every 15 s while healthy', () => {
    expect(nextPollInterval(false)).toBe(STATUS_POLL_INTERVAL_MS);
    expect(STATUS_POLL_INTERVAL_MS).toBe(15000);
  });

  it('backs off to 60 s after a failure', () => {
    expect(nextPollInterval(true)).toBe(STATUS_POLL_FAILING_INTERVAL_MS);
    expect(STATUS_POLL_FAILING_INTERVAL_MS).toBe(60000);
  });

  it('returns to 15 s on the first success', () => {
    expect(nextPollInterval(nextPollInterval(true) === 60000 ? false : true)).toBe(15000);
  });
});
