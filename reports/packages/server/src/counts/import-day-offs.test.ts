import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const state = vi.hoisted(() => ({
  settings: { bridgeApiUrl: 'http://bridge.local:3002/api/v1/time/export/day-offs?x=1', bridgeApiKey: 'brk_test' } as Record<string, string>,
  imported: { holidays: ['2026-01-01'], shortDays: ['2026-02-20'], badDays: ['2026-03-14'], offDays: ['2026-03-10'] },
}));

vi.mock('../settings/props', () => ({ getSettings: () => state.settings }));
vi.mock('./props', () => ({
  getProps: vi.fn(),
  addOffDays: vi.fn(),
  removeOffDay: vi.fn(),
  importDayOffs: vi.fn(() => state.imported),
}));

import { importDayOffs } from './props';
import { handleImportDayOffs } from './handler';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  state.settings = { bridgeApiUrl: 'http://bridge.local:3002/api/v1/time/export/day-offs?x=1', bridgeApiKey: 'brk_test' };
  vi.mocked(importDayOffs).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const run = async (id: string) => {
  const written: string[] = [];
  const res = {
    setHeader: vi.fn(),
    write: (chunk: string) => written.push(chunk),
    end: vi.fn(),
  } as unknown as Response;
  const req = { params: { id } } as unknown as Request<Record<string, string>>;

  await handleImportDayOffs(req, res);

  return written.map((line) => JSON.parse(line));
};

describe('handleImportDayOffs', () => {
  it('asks for the settings when bridge is not configured, and fetches and imports nothing', async () => {
    state.settings = {};
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const events = await run('2026');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].data).toMatch(/не настроена/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(importDayOffs).not.toHaveBeenCalled();
  });

  it("requests the given year with the API key and passes bridge's payload to importDayOffs", async () => {
    const payload = { year: 2026, holidays: ['2026-05-01'], shortDays: [], badDays: [], offDays: ['2026-05-04'] };
    let request: { url: string; init: RequestInit } | undefined;
    globalThis.fetch = (async (url: URL, init: RequestInit) => {
      request = { url: url.href, init };
      return Response.json(payload);
    }) as unknown as typeof fetch;

    const events = await run('2026');
    const url = new URL(request?.url ?? '');

    expect(url.searchParams.get('x')).toBe('1');
    expect(url.searchParams.get('year')).toBe('2026');
    expect((request?.init.headers as Record<string, string>)['X-Api-Key']).toBe('brk_test');
    expect(importDayOffs).toHaveBeenCalledWith('2026', payload);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('message');
  });

  it('reports the status when bridge answers with an error, and imports nothing', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;

    const events = await run('2026');

    expect(events).toEqual([{ type: 'error', data: 'Bridge API вернул ошибку 500' }]);
    expect(importDayOffs).not.toHaveBeenCalled();
  });
});
