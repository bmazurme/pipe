import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  settings: { bridgeApiUrl: 'http://bridge.local:3002/api/v1/time/export/day-offs?x=1', bridgeApiKey: 'brk_test' } as Record<string, string>,
  props: { holidays: ['2026-01-01'], shortDays: ['2026-02-20'], badDays: ['2026-03-14'], offDays: ['2026-03-10'] },
}));

vi.mock('../settings/props', () => ({ getSettings: () => state.settings }));
vi.mock('./props', () => ({
  getProps: () => state.props,
  addOffDays: vi.fn(),
  removeOffDay: vi.fn(),
  importDayOffs: vi.fn(),
}));

import { bridgeSendUrl, sendDayOffsToBridge } from './handler';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  state.settings = { bridgeApiUrl: 'http://bridge.local:3002/api/v1/time/export/day-offs?x=1', bridgeApiKey: 'brk_test' };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('bridgeSendUrl', () => {
  it('turns the export address from Settings into the address that takes the dates', () => {
    expect(bridgeSendUrl('http://bridge.local:3002/api/v1/time/export/day-offs?year=2026').href).toBe(
      'http://bridge.local:3002/api/v1/time/import/day-offs',
    );
    expect(bridgeSendUrl('https://api.bridge.ntlstl.dev/api/v1/time/export/day-offs/').pathname).toBe('/api/v1/time/import/day-offs');
  });

  it('says what the address has to look like when it does not end that way', () => {
    expect(() => bridgeSendUrl('https://bridge.example/anything')).toThrow(/должен оканчиваться на \/time\/export\/day-offs/);
  });
});

describe('sendDayOffsToBridge', () => {
  it("posts the year's four lists with the API key and returns bridge's counts", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    globalThis.fetch = (async (url: URL, init: RequestInit) => {
      request = { url: url.href, init };
      return Response.json({ year: 2026, created: 3, updated: 1, unchanged: 0 });
    }) as unknown as typeof fetch;

    const result = await sendDayOffsToBridge('2026');

    expect(result).toEqual({ year: 2026, created: 3, updated: 1, unchanged: 0 });
    expect(request?.url).toBe('http://bridge.local:3002/api/v1/time/import/day-offs');
    expect(request?.init.method).toBe('POST');
    expect((request?.init.headers as Record<string, string>)['X-Api-Key']).toBe('brk_test');
    expect(JSON.parse(String(request?.init.body))).toEqual({ year: 2026, ...state.props });
  });

  it('asks for the settings when bridge is not configured, and sends nothing', async () => {
    state.settings = {};
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    await expect(sendDayOffsToBridge('2026')).rejects.toThrow(/не настроена/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('carries bridge\'s own reason when it refuses the dates', async () => {
    globalThis.fetch = (async () => Response.json({ message: ['every date must be a real calendar date'] }, { status: 400 })) as unknown as typeof fetch;

    await expect(sendDayOffsToBridge('2026')).rejects.toThrow(/400: every date must be a real calendar date/);
  });
});
