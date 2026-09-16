import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CONFIG_PATH, CREDENTIALS_PATH, GITLAB_WORKER_STATE_PATH } from '../paths.js';
import { saveApiKey, saveGitlabToken } from '../credentials.js';
import { saveConfig } from '../config.js';
import { issueKey, loadGitlabWorkerState, recordPushed } from '../gitlabWorkerState.js';
import type { SyncConfig } from '../types.js';
import { runGitlabWorkerOnce } from './gitlabWorker.js';

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
