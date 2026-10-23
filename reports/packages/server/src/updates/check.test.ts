import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReleaseInfoType } from '@reports/shared';

const state = vi.hoisted(() => ({ settings: {} as Record<string, string> }));
vi.mock('../settings/props', () => ({ getSettings: () => state.settings }));
const installedState = vi.hoisted(() => ({ release: null as { releaseId: string; shortId: string; version: string | null } | null }));
vi.mock('./release', async (importOriginal) => ({ ...(await importOriginal<typeof import('./release')>()), readInstalledRelease: () => installedState.release }));

import { DOWNLOAD_TIMEOUT_MS } from './apply';
import { CHECK_TIMEOUT_MS, createUpdateChecker, fetchLatestRelease } from './check';

const release = (id: string, version: string | null = '1.0.0'): ReleaseInfoType & { sha256: string; size: number } => ({
  releaseId: id.repeat(64).slice(0, 64),
  shortId: id.repeat(12),
  version,
  sha256: 'd',
  size: 1,
});

function checker(over: { installed?: ReleaseInfoType | null; latest?: () => Promise<ReturnType<typeof release>>; now?: () => number } = {}) {
  const installed = { value: over.installed === undefined ? release('a') : over.installed };
  const fetchLatest = vi.fn(over.latest ?? (async () => release('b', '1.1.0')));
  const clock = { t: 0 };

  return {
    fetchLatest,
    clock,
    installed,
    checker: createUpdateChecker({ readInstalled: () => installed.value, fetchLatest, now: over.now ?? (() => clock.t), ttlMs: 1000 }),
  };
}

describe('the update status', () => {
  it('offers an update when bridge has another build than the one running', async () => {
    const { checker: c } = checker();

    const status = await c.status();

    expect(status).toMatchObject({ updateAvailable: true, error: null, latest: { version: '1.1.0' }, current: { version: '1.0.0' } });
    expect(status.checkedAt).not.toBeNull();
  });

  it('offers nothing when the running build is the one on offer', async () => {
    const { checker: c } = checker({ latest: async () => release('a') });

    expect((await c.status()).updateAvailable).toBe(false);
  });

  it('treats a build that cannot say which it is as outdated', async () => {
    const { checker: c } = checker({ installed: null });

    expect(await c.status()).toMatchObject({ current: null, updateAvailable: true });
  });

  it('says why the check could not be made, and offers nothing', async () => {
    const { checker: c } = checker({
      latest: async () => {
        throw new Error('Bridge недоступен');
      },
    });

    expect(await c.status()).toMatchObject({ updateAvailable: false, latest: null, error: 'Bridge недоступен' });
  });

  it('remembers the answer for a while, asks again after it, and when asked to refresh', async () => {
    const { checker: c, fetchLatest, clock } = checker();

    await c.status();
    await c.status();
    expect(fetchLatest).toHaveBeenCalledTimes(1);

    clock.t = 5000;
    await c.status();
    expect(fetchLatest).toHaveBeenCalledTimes(2);

    await c.status({ refresh: true });
    expect(fetchLatest).toHaveBeenCalledTimes(3);
  });

  it('shares one request between callers that ask at the same time', async () => {
    const { checker: c, fetchLatest } = checker();

    await Promise.all([c.status(), c.status(), c.status()]);

    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it('notices from the cached answer that the update was applied since', async () => {
    const { checker: c, installed } = checker();

    expect((await c.status()).updateAvailable).toBe(true);

    installed.value = release('b', '1.1.0');

    expect((await c.status()).updateAvailable).toBe(false);
  });
});

describe('the update status after a failed check', () => {
  function flakyChecker() {
    const clock = { t: 0 };
    const outcome = { fail: true };
    const fetchLatest = vi.fn(async () => {
      if (outcome.fail) throw new Error('Bridge не ответил вовремя');

      return release('b', '1.1.0');
    });
    const c = createUpdateChecker({ readInstalled: () => release('a'), fetchLatest, now: () => clock.t, ttlMs: 10_000, failureTtlMs: 1000 });

    return { checker: c, fetchLatest, clock, outcome };
  }

  it('remembers a failure only for failureTtlMs, then asks again', async () => {
    const { checker: c, fetchLatest, clock, outcome } = flakyChecker();

    expect((await c.status()).error).toBe('Bridge не ответил вовремя');

    clock.t = 999;
    expect((await c.status()).error).toBe('Bridge не ответил вовремя');
    expect(fetchLatest).toHaveBeenCalledTimes(1);

    outcome.fail = false;
    clock.t = 1000;
    expect(await c.status()).toMatchObject({ error: null, updateAvailable: true });
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  it('still remembers a successful check for ttlMs', async () => {
    const { checker: c, fetchLatest, clock, outcome } = flakyChecker();
    outcome.fail = false;

    await c.status();

    clock.t = 9999;
    await c.status();
    expect(fetchLatest).toHaveBeenCalledTimes(1);

    clock.t = 10_000;
    await c.status();
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  it('waits longer than bridge takes to cut a build, but less than a download', () => {
    expect(CHECK_TIMEOUT_MS).toBeGreaterThan(51_000);
    expect(CHECK_TIMEOUT_MS).toBeLessThan(DOWNLOAD_TIMEOUT_MS);
  });
});

describe('fetchLatestRelease', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    state.settings = {};
  });

  it('asks the bridge of the settings, with the key, at its release route', async () => {
    state.settings = { bridgeApiUrl: 'https://api.bridge.example/api/v1/time/export/day-offs', bridgeApiKey: 'brk_one', bridgeStorageApiKey: 'brk_two' };
    let seen: { url: string; key: string } | undefined;
    globalThis.fetch = (async (url: URL, init: RequestInit) => {
      seen = { url: url.href, key: (init.headers as Record<string, string>)['X-Api-Key'] };
      return Response.json({ releaseId: 'c'.repeat(64), shortId: 'cccccccccccc', version: '1.2.0', sha256: 'd', size: 10 });
    }) as unknown as typeof fetch;

    const info = await fetchLatestRelease();

    expect(seen).toEqual({ url: 'https://api.bridge.example/api/v1/reports-release/info', key: 'brk_two' });
    expect(info).toMatchObject({ version: '1.2.0', size: 10 });
  });

  it('tells bridge the installed release in X-Reports-Release, and sends no such header when none is installed', async () => {
    state.settings = { bridgeApiUrl: 'https://b.example/x', bridgeApiKey: 'k' };
    const seen: Array<Record<string, string>> = [];
    globalThis.fetch = (async (_url: URL, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return Response.json({ releaseId: 'c'.repeat(64), sha256: 'd' });
    }) as unknown as typeof fetch;

    installedState.release = { releaseId: 'a'.repeat(64), shortId: 'a'.repeat(12), version: '1.0.0' };
    await fetchLatestRelease();
    installedState.release = null;
    await fetchLatestRelease();

    expect(seen[0]['X-Reports-Release']).toBe('a'.repeat(64));
    expect(seen[1]).not.toHaveProperty('X-Reports-Release');
  });

  it('asks for the settings when bridge is not configured', async () => {
    await expect(fetchLatestRelease()).rejects.toThrow(/укажите адрес bridge/);
  });

  it('explains a refusal, an unconfigured GitHub and a bridge too old to know releases', async () => {
    state.settings = { bridgeApiUrl: 'https://b.example/x', bridgeApiKey: 'k' };
    const answer = (status: number, body: unknown = {}) => {
      globalThis.fetch = (async () => Response.json(body, { status })) as unknown as typeof fetch;
    };

    answer(403);
    await expect(fetchLatestRelease()).rejects.toThrow(/только владельцу/);
    answer(503);
    await expect(fetchLatestRelease()).rejects.toThrow(/GITHUB_REPO/);
    answer(200, { sha: 'abc', shortSha: 'abc' });
    await expect(fetchLatestRelease()).rejects.toThrow(/старая версия/);
    answer(500);
    await expect(fetchLatestRelease()).rejects.toThrow(/ошибку 500/);
  });
});
