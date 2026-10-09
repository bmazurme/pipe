import { describe, expect, it } from 'vitest';

import { describeApiError } from './describeApiError';

describe('describeApiError', () => {
  it('names the usual causes plainly', () => {
    expect(describeApiError({ status: 'FETCH_ERROR', error: 'TypeError' })).toBe('нет связи с сервером');
    expect(describeApiError({ status: 'TIMEOUT_ERROR' })).toBe('сервер не ответил вовремя');
    expect(describeApiError({ status: 401, data: { message: 'Unauthorized' } })).toBe('сеанс истёк — войдите заново');
    expect(describeApiError({ status: 429, data: {} })).toContain('слишком много запросов');
  });

  it('passes the server’s own message through, with the status', () => {
    expect(describeApiError({ status: 502, data: { message: 'VPN panel "primary" rejected the API token (401)' } })).toBe(
      'VPN panel "primary" rejected the API token (401) (HTTP 502)',
    );
    expect(describeApiError({ status: 400, data: { message: ['year must be an integer', 'month is required'] } })).toBe(
      'year must be an integer, month is required (HTTP 400)',
    );
  });

  it('falls back to the bare status, and tolerates anything', () => {
    expect(describeApiError({ status: 500, data: null })).toBe('HTTP 500');
    expect(describeApiError({ status: 'CUSTOM_ERROR', error: 'Файл слишком большой' })).toBe('Файл слишком большой');
    expect(describeApiError('уже строка')).toBe('уже строка');
    expect(describeApiError(undefined)).toBe('неизвестная ошибка');
    expect(describeApiError(42)).toBe('неизвестная ошибка');
  });
});
