import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { fetchLiveStatus, loadBridgeLiveConfig, type BridgeLiveConfigPaths } from './bridgeLive.js';

function makeConfigPaths(dir: string): BridgeLiveConfigPaths {
  return {
    syncCredentials: path.join(dir, 'credentials.json'),
    syncConfig: path.join(dir, 'config.json'),
  };
}

describe('loadBridgeLiveConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-bridge-live-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is undefined when neither file exists', () => {
    assert.equal(loadBridgeLiveConfig(makeConfigPaths(dir)), undefined);
  });

  it('is undefined when the credentials file has no apiKey (refresh-token-only login)', () => {
    const paths = makeConfigPaths(dir);
    writeFileSync(paths.syncCredentials, JSON.stringify({ refreshToken: 'r' }));
    writeFileSync(paths.syncConfig, JSON.stringify({ bridge: { apiUrl: 'https://api.example' } }));

    assert.equal(loadBridgeLiveConfig(paths), undefined);
  });

  it('combines apiKey + apiUrl from the two files when both are present', () => {
    const paths = makeConfigPaths(dir);
    writeFileSync(paths.syncCredentials, JSON.stringify({ apiKey: 'brk_test' }));
    writeFileSync(paths.syncConfig, JSON.stringify({ bridge: { apiUrl: 'https://api.example' } }));

    assert.deepEqual(loadBridgeLiveConfig(paths), { apiUrl: 'https://api.example', apiKey: 'brk_test' });
  });
});

describe('fetchLiveStatus', () => {
  let dir: string;
  let paths: BridgeLiveConfigPaths;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'harness-bridge-live-'));
    paths = makeConfigPaths(dir);
    writeFileSync(paths.syncCredentials, JSON.stringify({ apiKey: 'brk_test' }));
    writeFileSync(paths.syncConfig, JSON.stringify({ bridge: { apiUrl: 'https://api.example' } }));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  it('reports unavailable with a clear reason when there is no API key configured', async () => {
    rmSync(paths.syncCredentials);

    const result = await fetchLiveStatus(paths);

    assert.equal(result.available, false);
    if (result.available) throw new Error('unreachable');
    assert.match(result.reason, /no bridge API key configured/);
  });

  it('reports unavailable with the error message when a bridge call fails', async () => {
    globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;

    const result = await fetchLiveStatus(paths);

    assert.equal(result.available, false);
    if (result.available) throw new Error('unreachable');
    assert.match(result.reason, /bridge live check failed/);
  });

  it('joins jobs and storage files into a per-task view, by taskKey', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith('/api/v1/worker/status')) {
        return Response.json({ isUp: true, workers: [{ name: 'worker-1', lastSeenAt: '2026-10-04T09:00:00.000Z', isUp: true }] });
      }
      if (url.endsWith('/api/v1/storage')) {
        return Response.json([
          { id: 1, taskKey: '402:6', direction: 'outbound' },
          { id: 2, taskKey: '402:6', direction: 'result' },
          { id: 3, taskKey: null, direction: null },
        ]);
      }
      if (url.endsWith('/api/v1/worker/jobs')) {
        return Response.json([
          {
            id: 42,
            sourceFileId: 1,
            resultFileId: 2,
            model: 'gpt',
            status: 'succeeded',
            errorMessage: null,
            createdAt: '2026-10-04T08:00:00.000Z',
            finishedAt: '2026-10-04T08:05:00.000Z',
          },
        ]);
      }
      if (url.endsWith('/api/v1/worker/claude-credentials')) {
        return Response.json([{ id: 1, name: 'sonnet-key', createdAt: '2026-10-01T00:00:00.000Z' }]);
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const result = await fetchLiveStatus(paths);

    assert.equal(result.available, true);
    if (!result.available) throw new Error('unreachable');
    assert.equal(result.data.worker.isUp, true);
    assert.deepEqual(result.data.claudeCredentials, [{ name: 'sonnet-key', createdAt: '2026-10-01T00:00:00.000Z' }]);

    const task = result.data.tasks.get('402:6');
    assert.ok(task);
    assert.equal(task?.hasResultInStorage, true);
    assert.deepEqual(task?.job, {
      id: 42,
      status: 'succeeded',
      model: 'gpt',
      errorMessage: null,
      createdAt: '2026-10-04T08:00:00.000Z',
      finishedAt: '2026-10-04T08:05:00.000Z',
    });
  });

  it('marks a task with an outbound file but no result file as not-yet-resulted', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith('/api/v1/worker/status')) {
        return Response.json({ isUp: false, workers: [] });
      }
      if (url.endsWith('/api/v1/storage')) {
        return Response.json([{ id: 1, taskKey: '402:7', direction: 'outbound' }]);
      }
      if (url.endsWith('/api/v1/worker/jobs')) {
        return Response.json([]);
      }
      if (url.endsWith('/api/v1/worker/claude-credentials')) {
        return Response.json([]);
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const result = await fetchLiveStatus(paths);

    assert.equal(result.available, true);
    if (!result.available) throw new Error('unreachable');
    assert.equal(result.data.tasks.get('402:7')?.hasResultInStorage, false);
    assert.equal(result.data.tasks.get('402:7')?.job, undefined);
  });

  it('exposes configured Claude credential names without their token values', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith('/api/v1/worker/status')) return Response.json({ isUp: true, workers: [] });
      if (url.endsWith('/api/v1/storage')) return Response.json([]);
      if (url.endsWith('/api/v1/worker/jobs')) return Response.json([]);
      if (url.endsWith('/api/v1/worker/claude-credentials')) {
        return Response.json([
          { id: 1, name: 'personal', createdAt: '2026-09-01T00:00:00.000Z' },
          { id: 2, name: 'work', createdAt: '2026-09-15T00:00:00.000Z' },
        ]);
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const result = await fetchLiveStatus(paths);

    assert.equal(result.available, true);
    if (!result.available) throw new Error('unreachable');
    assert.deepEqual(result.data.claudeCredentials, [
      { name: 'personal', createdAt: '2026-09-01T00:00:00.000Z' },
      { name: 'work', createdAt: '2026-09-15T00:00:00.000Z' },
    ]);
  });
});
