import type { BridgeReportEntry } from '@reports/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  settings: {} as Record<string, string>,
}));

vi.mock('../settings/props', () => ({ getSettings: () => state.settings }));

import { pushReportToBridge } from './push-to-bridge';

const originalFetch = globalThis.fetch;
const entries = [{ date: '2026-03-02', hours: 8 }] as unknown as BridgeReportEntry[];

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl);
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

beforeEach(() => {
  state.settings = { bridgeApiUrl: 'http://bridge.local:3002/api/v1/time/export/day-offs?x=1', bridgeApiKey: 'brk_test' };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('pushReportToBridge', () => {
  it.each([
    ['empty address', { bridgeApiUrl: '', bridgeApiKey: 'brk_test' }],
    ['empty key', { bridgeApiUrl: 'http://bridge.local:3002/x', bridgeApiKey: '' }],
  ])('asks for the settings on %s and sends nothing', async (_name, settings) => {
    state.settings = settings;
    const fetchMock = stubFetch(async () => Response.json({}));

    await expect(pushReportToBridge(2026, 3, entries)).rejects.toThrow(/не настроена/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the origin of the configured address with the key and the report body, and returns the parsed reply', async () => {
    const fetchMock = stubFetch(async () => Response.json({ created: 1 }));

    const result = await pushReportToBridge(2026, 3, entries);

    expect(result).toEqual({ created: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://bridge.local:3002/api/v1/time/import/reports');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'X-Api-Key': 'brk_test', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ year: 2026, month: 3, entries });
  });

  it('joins an array message from bridge', async () => {
    stubFetch(async () => Response.json({ message: ['a', 'b'] }, { status: 400 }));

    await expect(pushReportToBridge(2026, 3, entries)).rejects.toThrow('Bridge API вернул ошибку 400: a; b');
  });

  it('uses a string message from bridge as is', async () => {
    stubFetch(async () => Response.json({ message: 'x' }, { status: 400 }));

    await expect(pushReportToBridge(2026, 3, entries)).rejects.toThrow('Bridge API вернул ошибку 400: x');
  });

  it('reports only the status when the error body is not JSON', async () => {
    stubFetch(async () => new Response('Bad Gateway', { status: 502 }));

    await expect(pushReportToBridge(2026, 3, entries)).rejects.toThrow(/^Bridge API вернул ошибку 502$/);
  });

  it('describes a refused connection in words', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    });

    await expect(pushReportToBridge(2026, 3, entries)).rejects.toThrow(/соединение отклонено/);
  });
});
