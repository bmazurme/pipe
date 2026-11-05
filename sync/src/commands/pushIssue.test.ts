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

  it('--dry-run previews and uploads nothing', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'sync-cli-push-issue-test-dry-'));
    writeFileSync(path.join(projectPath, 'a.ts'), 'export const a = 1;');

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('should not be called');
    }) as typeof fetch;

    const project = makeProject(projectPath, { include: ['**/*.ts'] });
    const result = await buildAndUploadIssueParcel(project, config, issue, 'task/173-628', 'gitlab-token', {
      dryRun: true,
    });

    assert.equal(result, null);
    assert.equal(fetchCalled, false);

    rmSync(projectPath, { recursive: true, force: true });
  });

  it('--dry-run --strict still aborts on a leak finding', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'sync-cli-push-issue-test-dry-strict-'));
    writeFileSync(path.join(projectPath, 'a.ts'), 'const contact = "oncall@acme-corp.example";');

    globalThis.fetch = (async () => {
      throw new Error('should not be called');
    }) as typeof fetch;

    const project = makeProject(projectPath, { include: ['**/*.ts'] });
    await assert.rejects(
      buildAndUploadIssueParcel(project, config, issue, 'task/173-628', 'gitlab-token', { dryRun: true, strict: true }),
      /--strict/,
    );

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

describe('buildAndUploadIssueParcel — issue comments', () => {
  const gitlabConfig: SyncConfig = { ...config, gitlab: { apiUrl: 'https://gitlab.example.com/api/v4' } };
  const PNG_BYTES = new Uint8Array([1, 2, 3, 4]);

  // Routes the notes request, image downloads and the bridge upload; `notes` is what the notes API answers
  // (a Response for a failure), and the uploaded parcel is handed back for inspection.
  function mockFetch(notes: unknown[] | Response): { uploaded: () => Buffer | undefined; urls: string[] } {
    let uploadedBuffer: Buffer | undefined;
    const urls: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url.includes('/issues/628/notes')) {
        return notes instanceof Response ? notes : new Response(JSON.stringify(notes), { status: 200 });
      }
      if (url.includes('/uploads/')) {
        return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (url.includes('/api/v1/storage')) {
        const body = init?.body as unknown as { get(name: string): unknown };
        uploadedBuffer = Buffer.from(await (body.get('file') as Blob).arrayBuffer());
        return new Response(
          JSON.stringify({ id: 1, originalName: '173-628.subscription.zip', mimeType: 'application/zip', size: uploadedBuffer.length, createdAt: new Date().toISOString() }),
          { status: 201 },
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as typeof fetch;
    return { uploaded: () => uploadedBuffer, urls };
  }

  function makeProjectDir(prefix: string): string {
    const projectPath = mkdtempSync(path.join(tmpdir(), prefix));
    writeFileSync(path.join(projectPath, 'a.ts'), 'export const a = 1;');
    return projectPath;
  }

  it('anonymizes the non-system notes into issueComments, oldest first, and takes images from them', async () => {
    const projectPath = makeProjectDir('sync-cli-push-issue-comments-');
    const dictionaryPath = path.join(projectPath, 'dict.json');
    writeFileSync(dictionaryPath, JSON.stringify({ ClearingIdentifier: '{{ENTITY}}', 'Ivan Petrov': '{{PERSON}}' }));

    const fetchMock = mockFetch([
      { id: 1, body: 'ClearingIdentifier must also cover refunds', system: false, created_at: '2026-11-01T10:00:00Z', author: { name: 'Ivan Petrov' } },
      { id: 2, body: 'changed the description', system: true, created_at: '2026-11-01T11:00:00Z', author: { name: 'Ivan Petrov' } },
      { id: 3, body: 'Screenshot: ![shot](/uploads/abc/shot.png)', system: false, created_at: '2026-11-02T09:00:00Z', author: { username: 'qa' } },
    ]);

    const project = makeProject(projectPath, { dictionary: dictionaryPath, include: ['**/*.ts'] });
    const result = await buildAndUploadIssueParcel(project, gitlabConfig, issue, 'task/173-628', 'gitlab-token');

    assert.ok(result);
    const { manifest, assets } = extractIssueArchive(fetchMock.uploaded()!);
    assert.deepEqual(manifest.issueComments, [
      { author: '{{PERSON}}', createdAt: '2026-11-01T10:00:00Z', body: '{{ENTITY}} must also cover refunds' },
      { author: 'qa', createdAt: '2026-11-02T09:00:00Z', body: 'Screenshot: ![shot](/uploads/abc/shot.png)' },
    ]);
    assert.deepEqual(
      assets.map((asset) => asset.relPath),
      ['issue-images/shot.png'],
    );

    rmSync(projectPath, { recursive: true, force: true });
  });

  it('leaves issueComments out when the issue has no comments', async () => {
    const projectPath = makeProjectDir('sync-cli-push-issue-no-comments-');
    const fetchMock = mockFetch([]);

    const project = makeProject(projectPath, { include: ['**/*.ts'] });
    await buildAndUploadIssueParcel(project, gitlabConfig, issue, 'task/173-628', 'gitlab-token');

    const { manifest } = extractIssueArchive(fetchMock.uploaded()!);
    assert.equal('issueComments' in manifest, false);

    rmSync(projectPath, { recursive: true, force: true });
  });

  it('--strict aborts on a leak found in a comment', async () => {
    const projectPath = makeProjectDir('sync-cli-push-issue-comment-leak-');
    const fetchMock = mockFetch([
      { id: 1, body: 'ping oncall@acme-corp.example', system: false, created_at: '2026-11-01T10:00:00Z', author: { name: 'x' } },
    ]);

    const project = makeProject(projectPath, { include: ['**/*.ts'] });
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
    try {
      await assert.rejects(
        buildAndUploadIssueParcel(project, gitlabConfig, issue, 'task/173-628', 'gitlab-token', { strict: true }),
        /--strict/,
      );
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(warnings.some((line) => line.includes('issue comment 1')));
    assert.equal(fetchMock.uploaded(), undefined);

    rmSync(projectPath, { recursive: true, force: true });
  });

  it('pushes without comments when the notes request fails', async () => {
    const projectPath = makeProjectDir('sync-cli-push-issue-notes-fail-');
    const fetchMock = mockFetch(new Response('boom', { status: 500 }));

    const project = makeProject(projectPath, { include: ['**/*.ts'] });
    const result = await buildAndUploadIssueParcel(project, gitlabConfig, issue, 'task/173-628', 'gitlab-token');

    assert.ok(result);
    const { manifest } = extractIssueArchive(fetchMock.uploaded()!);
    assert.equal(manifest.issueComments, undefined);

    rmSync(projectPath, { recursive: true, force: true });
  });
});
