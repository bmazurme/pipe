import { describe, it, expect } from 'vitest';

import { describeFetchError } from './describe-fetch-error';

const fetchFailed = (code?: string) => {
  const error = new TypeError('fetch failed');

  if (code) {
    (error as { cause?: unknown }).cause = { code };
  }

  return error;
};

describe('describeFetchError', () => {
  it('describes a connect timeout with the target host', () => {
    const result = describeFetchError(fetchFailed('UND_ERR_CONNECT_TIMEOUT'), 'https://api.bridge.ntlstl.dev/api/v1/time/import/reports');

    expect(result.message).toContain('api.bridge.ntlstl.dev');
    expect(result.message).toContain('таймаут соединения');
  });

  it('describes a DNS resolution failure', () => {
    const result = describeFetchError(fetchFailed('ENOTFOUND'), 'https://unknown.example');

    expect(result.message).toContain('хост не найден');
  });

  it('describes a refused connection', () => {
    const result = describeFetchError(fetchFailed('ECONNREFUSED'), 'http://localhost:3002');

    expect(result.message).toContain('отклонено');
  });

  it('falls back to the original error for non-network errors', () => {
    const original = new Error('boom');

    expect(describeFetchError(original, 'https://example.com')).toBe(original);
  });
});
