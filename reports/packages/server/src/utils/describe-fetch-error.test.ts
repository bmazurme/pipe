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

  it('explains a proxy that refuses the tunnel and suggests NO_PROXY', () => {
    const error = new TypeError('fetch failed');
    (error as { cause?: unknown }).cause = { message: 'Request was cancelled.', cause: { message: 'Proxy response (403) !== 200 when HTTP Tunneling' } };

    const result = describeFetchError(error, 'https://git.example.dom/api/v4');

    expect(result.message).toContain('Прокси отклонил');
    expect(result.message).toContain('403');
    expect(result.message).toContain('NO_PROXY=git.example.dom');
  });

  it('points to NODE_EXTRA_CA_CERTS for an untrusted certificate', () => {
    expect(describeFetchError(fetchFailed('SELF_SIGNED_CERT_IN_CHAIN'), 'https://git.example.dom').message).toContain('NODE_EXTRA_CA_CERTS');
  });

  it('reads the code from a nested cause', () => {
    const error = new TypeError('fetch failed');
    (error as { cause?: unknown }).cause = { cause: { code: 'ENOTFOUND' } };

    expect(describeFetchError(error, 'https://x.example').message).toContain('DNS');
  });

  it('describes a timeout with the host', () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';

    expect(describeFetchError(timeout, 'https://slow.example/x').message).toContain('slow.example');
  });
});
