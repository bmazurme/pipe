import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { extractIssueArchive } from '../issuePack.js';
import { CREDENTIALS_PATH } from '../paths.js';
import { saveApiKey } from '../credentials.js';
import type { GitlabIssue } from '../gitlabClient.js';
import type { ProjectConfig, SyncConfig } from '../types.js';
import { buildAndUploadIssueParcel } from './pushIssue.js';

// Backs up/restores the real CREDENTIALS_PATH (a fixed path, not injectable)
// so a developer's actual saved credentials survive running this suite.
// That file is shared with gitlabWorker.test.ts's own backup/restore of the
// same path — the "test" script's --test-concurrency=1 (see package.json)
// is required so the two files' before/after hooks never interleave.
const originalFetch = globalThis.fetch;
const originalCredentials = existsSync(CREDENTIALS_PATH) ? readFileSync(CREDENTIALS_PATH, 'utf-8') : null;

before(() => {
  // buildAndUploadIssueParcel's client.upload() call needs *some* credential
  // to authorize with — an API key (item #8) skips the refresh-token dance
  // entirely, so the test only has to mock the one upload request below.
  saveApiKey('brk_test-key');
});

after(() => {
  if (originalCredentials === null) {
    rmSync(CREDENTIALS_PATH, { force: true });
  } else {
    writeFileSync(CREDENTIALS_PATH, originalCredentials);
  }
  globalThis.fetch = originalFetch;
});

function makeProject(projectPath: string, overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return { name: 'demo', path: projectPath, dictionary: undefined, ...overrides };
}

const config: SyncConfig = { bridge: { apiUrl: 'https://bridge.example.com' }, projects: [] };

const issue: GitlabIssue = {
  id: 14324,
  iid: 628,
  project_id: 173,
  title: 'Fix ClearingIdentifier',
  description: 'See ClearingIdentifier for details',
};

describe('buildAndUploadIssueParcel', () => {
  it('anonymizes files and issue text, then uploads the parcel', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'sync-cli-push-issue-test-'));
    writeFileSync(path.join(projectPath, 'a.ts'), 'export const owner = "ClearingIdentifier";');
    const dictionaryPath = path.join(projectPath, 'dict.json');
    writeFileSync(dictionaryPath, JSON.stringify({ ClearingIdentifier: '{{ENTITY}}' }));

    let uploadedBuffer: Buffer | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      assert.equal(url, 'https://bridge.example.com/api/v1/storage');
      const body = init?.body as unknown as { get(name: string): unknown };
      const file = body.get('file') as Blob;
      uploadedBuffer = Buffer.from(await file.arrayBuffer());
      return new Response(
        JSON.stringify({ id: 1, originalName: '173-628.subscription.zip', mimeType: 'application/zip', size: uploadedBuffer.length, createdAt: new Date().toISOString() }),
        { status: 201 },
      );
    }) as typeof fetch;

    const project = makeProject(projectPath, { dictionary: dictionaryPath, include: ['**/*.ts'] });
    const result = await buildAndUploadIssueParcel(project, config, issue, 'task/173-628', 'gitlab-token');

    assert.ok(result);
    assert.equal(result!.filename, '173-628.subscription.zip');
    assert.equal(result!.fileCount, 1);
    assert.equal(result!.encrypted, false);

    const { manifest, files } = extractIssueArchive(uploadedBuffer!);
    assert.equal(manifest.branch, 'task/173-628');
    assert.equal(manifest.issueTitle, 'Fix {{ENTITY}}');
    assert.equal(manifest.issueDescription, 'See {{ENTITY}} for details');
    assert.equal(files[0].content, 'export const owner = "{{ENTITY}}";');

    rmSync(projectPath, { recursive: true, force: true });
  });

  it('--strict aborts (and uploads nothing) when the leak scan finds something', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'sync-cli-push-issue-test-strict-'));
    writeFileSync(path.join(projectPath, 'a.ts'), 'const contact = "oncall@acme-corp.example";');

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('should not be called');
    }) as typeof fetch;

    const project = makeProject(projectPath, { include: ['**/*.ts'] });

    await assert.rejects(
      buildAndUploadIssueParcel(project, config, issue, 'task/173-628', 'gitlab-token', { strict: true }),
      /--strict/,
    );
    assert.equal(fetchCalled, false);

    rmSync(projectPath, { recursive: true, force: true });
  });

  it('without --strict, a leak finding only warns and the upload still proceeds', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'sync-cli-push-issue-test-warn-'));
    writeFileSync(path.join(projectPath, 'a.ts'), 'const contact = "oncall@acme-corp.example";');

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(
        JSON.stringify({ id: 1, originalName: '173-628.subscription.zip', mimeType: 'application/zip', size: 1, createdAt: new Date().toISOString() }),
        { status: 201 },
      );
    }) as typeof fetch;

    const project = makeProject(projectPath, { include: ['**/*.ts'] });
    const result = await buildAndUploadIssueParcel(project, config, issue, 'task/173-628', 'gitlab-token');

    assert.ok(result);
    assert.equal(fetchCalled, true);

    rmSync(projectPath, { recursive: true, force: true });
  });

  it('returns null and uploads nothing when no files match', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'sync-cli-push-issue-test-empty-'));
    mkdirSync(projectPath, { recursive: true });

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('should not be called');
    }) as typeof fetch;

    const project = makeProject(projectPath, { include: ['**/*.ts'] });
    const result = await buildAndUploadIssueParcel(project, config, issue, 'task/173-628', 'gitlab-token');

    assert.equal(result, null);
    assert.equal(fetchCalled, false);

    rmSync(projectPath, { recursive: true, force: true });
  });
});
