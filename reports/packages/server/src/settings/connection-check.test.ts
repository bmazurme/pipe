import { describe, it, expect, afterEach, vi } from 'vitest';
import type { SettingsType } from '@reports/shared';

import { checkBridge, checkGithub, checkGitlab, runConnectionCheck } from './connection-check';

const settings = (overrides: Partial<SettingsType> = {}): SettingsType => ({
  gitlabUrl: 'https://gitlab.example.com/api/v4/',
  privateToken: 'glpat-x',
  userId: '',
  employee: '',
  company: '',
  bridgeApiUrl: 'https://bridge.example.com/api/v1/time',
  bridgeApiKey: 'brk',
  ...overrides,
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const fetchMock = vi.fn();

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  fetchMock.mockImplementation((url: string, init: RequestInit) => Promise.resolve(handler(url, init)));
  vi.stubGlobal('fetch', fetchMock);
}

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('checkGitlab', () => {
  it('asks /user with the token and reports who it is', async () => {
    stubFetch(() => json({ id: 7, username: 'ivan', name: 'Иван' }));

    const items = await checkGitlab(settings());

    expect(fetchMock.mock.calls[0][0]).toBe('https://gitlab.example.com/api/v4/user');
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>)['Private-Token']).toBe('glpat-x');
    expect(items[0]).toMatchObject({ label: 'GitLab', status: 'ok' });
    expect(items[0].message).toContain('@ivan');
    expect(items[1]).toMatchObject({ label: 'ID пользователя', status: 'skip' });
  });

  it('warns when the configured user id belongs to someone else', async () => {
    stubFetch(() => json({ id: 7, username: 'ivan' }));

    const items = await checkGitlab(settings({ userId: '5' }));

    expect(items[1]).toMatchObject({ status: 'warn' });
    expect(items[1].message).toContain('5');
    expect(items[1].message).toContain('7');
  });

  it('accepts a matching user id', async () => {
    stubFetch(() => json({ id: 7, username: 'ivan' }));

    expect((await checkGitlab(settings({ userId: '7' })))[1].status).toBe('ok');
  });

  it.each([
    [401, 'отклонён'],
    [403, 'прав'],
    [404, '/api/v4'],
  ])('explains a %i answer', async (status, hint) => {
    stubFetch(() => json({ message: 'x' }, status));

    const items = await checkGitlab(settings());

    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('error');
    expect(items[0].message).toContain(hint);
  });

  it('recognises a login page served instead of the API', async () => {
    stubFetch(() => new Response('<html>Sign in</html>', { status: 200 }));

    const [entry] = await checkGitlab(settings());

    expect(entry.status).toBe('error');
    expect(entry.message).toContain('не похож на GitLab API');
  });

  it('fails without a request when the URL or the token is missing or malformed', async () => {
    stubFetch(() => json({}));

    expect((await checkGitlab(settings({ gitlabUrl: '' })))[0].message).toContain('GitLab URL');
    expect((await checkGitlab(settings({ privateToken: '' })))[0].message).toContain('токен');
    expect((await checkGitlab(settings({ gitlabUrl: 'не адрес' })))[0].message).toContain('не похож на адрес');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a proxy refusal into a NO_PROXY hint', async () => {
    const error = new TypeError('fetch failed');
    (error as { cause?: unknown }).cause = { cause: { message: 'Proxy response (403) !== 200 when HTTP Tunneling' } };
    stubFetch(() => Promise.reject(error) as unknown as Response);

    const [entry] = await checkGitlab(settings());

    expect(entry.status).toBe('error');
    expect(entry.message).toContain('NO_PROXY=gitlab.example.com');
  });
});

describe('checkGithub', () => {
  it('is skipped, not failed, without GITHUB_TOKEN', async () => {
    stubFetch(() => json({}));

    const items = await checkGithub(settings(), '');

    expect(items[0].status).toBe('skip');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the login the token belongs to', async () => {
    stubFetch(() => json({ login: 'octo' }, 200, { 'x-ratelimit-remaining': '4999' }));

    const items = await checkGithub(settings(), 'ghp_x');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/user');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'ok' });
    expect(items[0].message).toContain('octo');
  });

  it('warns when the rate limit is nearly used up', async () => {
    stubFetch(() => json({ login: 'octo' }, 200, { 'x-ratelimit-remaining': '3' }));

    expect((await checkGithub(settings(), 'ghp_x'))[1]).toMatchObject({ status: 'warn' });
  });

  it('flags a rejected token', async () => {
    stubFetch(() => json({ message: 'Bad credentials' }, 401));

    const [entry] = await checkGithub(settings(), 'ghp_x');

    expect(entry.status).toBe('error');
    expect(entry.message).toContain('401');
  });
});

describe('checkBridge', () => {
  it('is skipped when no bridge URL is set', async () => {
    stubFetch(() => json({}));

    expect((await checkBridge(settings({ bridgeApiUrl: '' })))[0].status).toBe('skip');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the origin health, then the key against a guarded route', async () => {
    stubFetch(() => json(null));

    const items = await checkBridge(settings());

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://bridge.example.com/api/v1/health',
      'https://bridge.example.com/api/v1/reports-settings',
    ]);
    expect((fetchMock.mock.calls[1][1].headers as Record<string, string>)['X-Api-Key']).toBe('brk');
    expect(items.map((i) => i.status)).toEqual(['ok', 'ok']);
  });

  it('reports a rejected key separately from a reachable server', async () => {
    stubFetch((url, init) => {
      if (url.endsWith('/health')) return json({ status: 'ok' });

      return (init.headers as Record<string, string>)['X-Api-Key'] ? json({}, 401) : json(null);
    });

    const items = await checkBridge(settings());

    expect(items[0].status).toBe('ok');
    expect(items[1]).toMatchObject({ label: 'API-ключ', status: 'error' });
  });

  it('skips keys that are not set', async () => {
    stubFetch(() => json(null));

    const items = await checkBridge(settings({ bridgeApiKey: '' }));

    expect(items.map((i) => i.status)).toEqual(['ok', 'skip']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after an unhealthy server instead of blaming the keys', async () => {
    stubFetch(() => json({ status: 'error' }, 503));

    const items = await checkBridge(settings());

    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('error');
    expect(items[0].message).toContain('503');
  });

  it('stops at an unreachable server', async () => {
    const error = new TypeError('fetch failed');
    (error as { cause?: unknown }).cause = { code: 'ENOTFOUND' };
    stubFetch(() => Promise.reject(error) as unknown as Response);

    const items = await checkBridge(settings());

    expect(items).toHaveLength(1);
    expect(items[0].message).toContain('DNS');
  });
});

describe('runConnectionCheck', () => {
  it('takes the worst item as the verdict', async () => {
    stubFetch(() => json({ id: 7, username: 'ivan' }));

    const result = await runConnectionCheck('gitlab', settings({ userId: '5' }));

    expect(result.target).toBe('gitlab');
    expect(result.status).toBe('warn');
    expect(result.items).toHaveLength(2);
  });
});
