import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CONFIG_PATH, CREDENTIALS_PATH, GITLAB_WORKER_STATE_PATH } from '../paths.js';
import { saveApiKey, saveGitlabToken } from '../credentials.js';
import { saveConfig } from '../config.js';
import { issueKey, loadGitlabWorkerState, recordPushed } from '../gitlabWorkerState.js';
import type { SyncConfig } from '../types.js';
import { runGitlabWorkerOnce, type PushBackoff } from './gitlabWorker.js';

const originalFetch = globalThis.fetch;
const originalConfig = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, 'utf-8') : null;
const originalCredentials = existsSync(CREDENTIALS_PATH) ? readFileSync(CREDENTIALS_PATH, 'utf-8') : null;
const originalWorkerState = existsSync(GITLAB_WORKER_STATE_PATH) ? readFileSync(GITLAB_WORKER_STATE_PATH, 'utf-8') : null;

const projectPath = mkdtempSync(path.join(tmpdir(), 'sync-cli-gitlab-worker-test-'));

before(() => {
  writeFileSync(path.join(projectPath, 'a.ts'), 'export const a = 1;');
  saveApiKey('brk_test-key');
  saveGitlabToken('gitlab-test-token');

  const config: SyncConfig = {
    bridge: { apiUrl: 'https://bridge.example.com' },
    gitlab: { apiUrl: 'https://gitlab.example.com/api/v4' },
    projects: [{ name: 'demo', path: projectPath, gitlabProjectId: '173', include: ['**/*.ts'] }],
  };
  saveConfig(config);
});

after(() => {
  rmSync(projectPath, { recursive: true, force: true });
  globalThis.fetch = originalFetch;

  for (const [file, original] of [
    [CONFIG_PATH, originalConfig],
    [CREDENTIALS_PATH, originalCredentials],
    [GITLAB_WORKER_STATE_PATH, originalWorkerState],
  ] as const) {
    if (original === null) rmSync(file, { force: true });
    else writeFileSync(file, original);
  }
});

describe('runGitlabWorkerOnce', () => {
  it('pushes only new issues belonging to the tracked project, skipping already-processed ones', async () => {
    rmSync(GITLAB_WORKER_STATE_PATH, { force: true });
    recordPushed(issueKey(173, 100), 'already-sent.zip'); // pre-existing, should be skipped

    const uploadedFilenames: string[] = [];

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.includes('/issues?scope=assigned_to_me')) {
        return new Response(
          JSON.stringify([
            { id: 1, iid: 100, project_id: 173, title: 'already processed', description: null },
            { id: 2, iid: 200, project_id: 173, title: 'new, matching project', description: null },
            { id: 3, iid: 300, project_id: 999, title: 'new, other project', description: null },
          ]),
          { status: 200 },
        );
      }

      if (url.includes('/api/v1/storage')) {
        const body = init?.body as unknown as { get(name: string): { name: string } };
        const filename = (body.get('file') as unknown as { name: string }).name;
        uploadedFilenames.push(filename);

        return new Response(
          JSON.stringify({ id: 1, originalName: filename, mimeType: 'application/zip', size: 10, createdAt: new Date().toISOString() }),
          { status: 201 },
        );
      }

      throw new Error(`Unexpected fetch to ${url}`);
    }) as typeof fetch;

    await runGitlabWorkerOnce('demo');

    assert.deepEqual(uploadedFilenames, ['173-200.subscription.zip']);

    const state = loadGitlabWorkerState();
    assert.ok(state[issueKey(173, 100)], 'pre-existing record is untouched');
    assert.ok(state[issueKey(173, 200)], 'newly pushed issue is recorded');
    assert.ok(!state[issueKey(999, 300)], 'issue from an untracked project is never recorded');
  });
});

describe('runGitlabWorkerOnce back-off', () => {
  const originalPath = process.env.PATH;
  const notifyDir = mkdtempSync(path.join(tmpdir(), 'sync-cli-notify-test-'));
  const notifyLog = path.join(notifyDir, 'calls.txt');

  before(() => {
    // Fake notifier so notify() calls can be counted (Linux only).
    const script = path.join(notifyDir, 'notify-send');
    writeFileSync(script, `#!/bin/sh\necho "$1|$2" >> "${notifyLog}"\n`);
    chmodSync(script, 0o755);
    process.env.PATH = `${notifyDir}${path.delimiter}${originalPath}`;
  });

  after(() => {
    process.env.PATH = originalPath;
    rmSync(notifyDir, { recursive: true, force: true });
  });

  it('skips a failing issue until its back-off passes, keeps pushing others, notifies once', async () => {
    rmSync(GITLAB_WORKER_STATE_PATH, { force: true });
    const attempts: string[] = [];

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.includes('/issues?scope=assigned_to_me')) {
        return new Response(
          JSON.stringify([
            { id: 1, iid: 10, project_id: 173, title: 'bad', description: null },
            { id: 2, iid: 20, project_id: 173, title: 'good', description: null },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/api/v1/storage')) {
        const body = init?.body as unknown as { get(name: string): { name: string } };
        const filename = (body.get('file') as unknown as { name: string }).name;
        attempts.push(filename);
        if (filename.startsWith('173-10.')) return new Response('nope', { status: 500 });
        return new Response(
          JSON.stringify({ id: 1, originalName: filename, mimeType: 'application/zip', size: 10, createdAt: new Date().toISOString() }),
          { status: 201 },
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as typeof fetch;

    const backoff: PushBackoff = new Map();
    let clock = 1_000_000;
    const timing = { intervalMs: 60_000, now: () => clock };
    const bad = '173-10.subscription.zip';
    const good = '173-20.subscription.zip';

    await runGitlabWorkerOnce('demo', {}, backoff, timing);
    assert.deepEqual(attempts, [bad, good]);
    assert.equal(backoff.get(issueKey(173, 10))?.failures, 1);

    clock += 30_000; // still inside the 60 s window
    await runGitlabWorkerOnce('demo', {}, backoff, timing);
    assert.equal(attempts.filter((a) => a === bad).length, 1, 'not retried inside the window');

    clock += 40_000; // past the window
    await runGitlabWorkerOnce('demo', {}, backoff, timing);
    assert.equal(attempts.filter((a) => a === bad).length, 2, 'retried after the window');
    assert.equal(backoff.get(issueKey(173, 10))?.failures, 2);
    assert.equal(backoff.get(issueKey(173, 10))?.nextAttemptAt, clock + 120_000, 'delay doubles');
    assert.equal(attempts.filter((a) => a === good).length, 1, 'good issue pushed once');

    if (process.platform === 'linux') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const calls = readFileSync(notifyLog, 'utf-8')
        .split('\n')
        .filter((l) => l.startsWith('Task push failed|'));
      assert.equal(calls.length, 1, 'notified only on the first failure');
    }
  });

  it('drops a back-off entry once the issue leaves the assigned list', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes('/issues?scope=assigned_to_me')) return new Response('[]', { status: 200 });
      throw new Error(`Unexpected fetch to ${url}`);
    }) as typeof fetch;

    const backoff: PushBackoff = new Map([[issueKey(173, 10), { failures: 3, nextAttemptAt: Number.MAX_SAFE_INTEGER }]]);
    await runGitlabWorkerOnce('demo', {}, backoff, { intervalMs: 1000 });
    assert.equal(backoff.size, 0);
  });
});
