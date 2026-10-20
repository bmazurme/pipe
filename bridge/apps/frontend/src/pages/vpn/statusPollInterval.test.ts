import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';

import {
  nextPollInterval,
  STATUS_POLL_FAILING_INTERVAL_MS,
  STATUS_POLL_INTERVAL_MS,
  useFailureAwarePollInterval,
} from './statusPollInterval';

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

describe('useFailureAwarePollInterval', () => {
  const ok = { isError: false, isSuccess: true, isFetching: false };
  const failed = { isError: true, isSuccess: false, isFetching: false };
  const retrying = { isError: false, isSuccess: false, isFetching: true };

  it('backs off after a failure, stays backed off during a retry and recovers on success', () => {
    const { result, rerender } = renderHook(() => useFailureAwarePollInterval(20000, 60000));
    expect(result.current.intervalMs).toBe(20000);
    result.current.track(failed);
    rerender();
    expect(result.current.intervalMs).toBe(60000);
    result.current.track(retrying);
    rerender();
    expect(result.current.intervalMs).toBe(60000);
    result.current.track(ok);
    rerender();
    expect(result.current.intervalMs).toBe(20000);
  });
});
