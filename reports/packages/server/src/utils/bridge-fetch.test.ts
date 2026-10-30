import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bridgeErrorMessage, bridgeFetch, bridgeOrigin } from './bridge-fetch';

vi.mock('../settings/props', () => ({
  getSettings: () => ({ bridgeApiUrl: 'https://bridge.example/api/v1/time/export/day-offs', bridgeApiKey: 'stored-key' }),
}));

describe('bridge-fetch', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the origin of the configured address', () => {
    expect(bridgeOrigin()).toBe('https://bridge.example');
    expect(() => bridgeOrigin('')).toThrow('Интеграция с bridge не настроена');
  });

  it('sends the api key, JSON body and a timeout signal to origin + path', async () => {
    fetchMock.mockResolvedValue(new Response('{}'));

    await bridgeFetch('/api/v1/x', { method: 'PUT', json: { a: 1 } });

    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe('https://bridge.example/api/v1/x');
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'X-Api-Key': 'stored-key', 'Content-Type': 'application/json' });
    expect(init.body).toBe('{"a":1}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('prefers an explicit key and address', async () => {
    fetchMock.mockResolvedValue(new Response('{}'));

    await bridgeFetch('/p', { apiKey: 'k', bridgeUrl: 'http://other:1/foo' });

    expect(fetchMock.mock.calls[0][0]).toBe('http://other:1/p');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'X-Api-Key': 'k' });
  });

  it('passes network errors through describeFetchError', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') }));

    await expect(bridgeFetch('/p')).rejects.toThrow("Не удалось подключиться к bridge.example.");
  });

  it('joins array messages and keeps string ones', async () => {
    const make = (message: unknown) => new Response(JSON.stringify({ message }), { status: 400 });

    expect(await bridgeErrorMessage(make(['a', 'b']))).toBe('Bridge API вернул ошибку 400: a; b');
    expect(await bridgeErrorMessage(make('bad'), 'Свой префикс')).toBe('Свой префикс 400: bad');
    expect(await bridgeErrorMessage(new Response('x', { status: 500 }))).toBe('Bridge API вернул ошибку 500');
  });
});
