import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';

import { handleCheckConnection } from './handler';
import { SECRET_MASK } from './redact';

const stored = {
  gitlabUrl: 'https://stored.example/api/v4',
  privateToken: 'glpat-stored',
  userId: '',
  employee: '',
  company: '',
  bridgeApiUrl: '',
  bridgeApiKey: '',
};

vi.mock('./props', () => ({ getSettings: vi.fn(() => stored), setSettings: vi.fn() }));

const fakeRes = () => {
  const chunks: string[] = [];
  const res = { setHeader: vi.fn(), write: vi.fn((c: string) => chunks.push(c)), end: vi.fn() };

  return { res: res as unknown as Response, output: () => JSON.parse(chunks.join('').trim()) };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/settings/check/:target', () => {
  it('checks unsaved form values and swaps a masked secret for the stored one', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ id: 1, username: 'me' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { res, output } = fakeRes();

    await handleCheckConnection(
      { params: { target: 'gitlab' }, body: { settings: { gitlabUrl: 'https://typed.example/api/v4', privateToken: SECRET_MASK } } } as unknown as Request,
      res,
    );

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe('https://typed.example/api/v4/user');
    expect((calls[0][1].headers as Record<string, string>)['Private-Token']).toBe('glpat-stored');
    expect(output().data).toMatchObject({ target: 'gitlab', status: 'ok' });
  });

  it('falls back to the saved settings when the body has none', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ id: 1 }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await handleCheckConnection({ params: { target: 'gitlab' }, body: {} } as unknown as Request, fakeRes().res);

    expect((fetchMock.mock.calls as unknown as [string][])[0][0]).toBe('https://stored.example/api/v4/user');
  });

  it('never echoes a secret back', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))));
    const { res, output } = fakeRes();

    await handleCheckConnection({ params: { target: 'gitlab' }, body: {} } as unknown as Request, res);

    expect(JSON.stringify(output())).not.toContain('glpat-stored');
  });

  it('rejects an unknown target as a stream error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, output } = fakeRes();

    await handleCheckConnection({ params: { target: 'nope' }, body: {} } as unknown as Request, res);

    expect(output().type).toBe('error');
  });
});
