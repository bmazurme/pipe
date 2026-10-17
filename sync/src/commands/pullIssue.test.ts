import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import AdmZip from 'adm-zip';

import { buildArchive, SYNC_MANIFEST_ENTRY } from '@pipe/protocol';

import { saveApiKey } from '../credentials.js';
import { saveConfig } from '../config.js';
import { buildIssueArchive, ISSUE_FILE_NAME } from '../issuePack.js';
import { CONFIG_PATH, CREDENTIALS_PATH } from '../paths.js';
import type { SyncConfig } from '../types.js';

import { pullIssueCommand, watchForResult } from './pullIssue.js';

describe('watchForResult', () => {
  it('keeps polling after a thrown error and notifies once a pull succeeds', async () => {
    const results: Array<Error | boolean> = [new Error('bridge 503'), false, true];
    let calls = 0;
    let found = 0;
    const sleeps: number[] = [];

    await watchForResult(5, {
      pullOnce: async () => {
        const next = results[calls++];
        if (next instanceof Error) throw next;
        return next as boolean;
      },
      onFound: () => {
        found++;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    assert.equal(calls, 3);
    assert.equal(found, 1);
    assert.deepEqual(sleeps, [5000, 5000]);
  });

  it('still rejects immediately on an invalid --watch value', async () => {
    await assert.rejects(pullIssueCommand('p', '1', '2', { watch: 'abc' }), /--watch expects a positive number/);
    await assert.rejects(pullIssueCommand('p', '1', '2', { watch: '0' }), /--watch expects a positive number/);
  });
});

// Same fixed-path backup dance as pull.test.ts — CONFIG_PATH/CREDENTIALS_PATH
// aren't injectable, and --test-concurrency=1 keeps the hooks from interleaving.
describe('pullIssueCommand assets', () => {
  const NAME = 'pull-issue-assets-test-project';
  const apiUrl = 'https://bridge.example.com';
  const originalFetch = globalThis.fetch;
  const backedUp = [CONFIG_PATH, CREDENTIALS_PATH].map((p) => ({
    path: p,
    content: existsSync(p) ? readFileSync(p, 'utf-8') : null,
  }));
  const manifest = {
    issueId: '1',
    issueIid: '42',
    issueTitle: 'Fix bug',
    issueDescription: 'Details',
    projectId: 173,
    branch: 'user-20260914-42',
    createdAt: '2026-09-14T10:00:00.000Z',
  };
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
  const binaryResult = Buffer.from([0xff, 0xfe, 0x00, 0xc3, 0x28]);

  let root: string;
  let projectPath: string;

  function serve(buffer: Buffer): void {
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.startsWith(`${apiUrl}/api/v1/storage?`)) {
        return new Response(
          JSON.stringify([{ id: 9, originalName: 'issue-42.zip', createdAt: '2026-09-14T10:00:00Z' }]),
          { status: 200 },
        );
      }
      if (/\/storage\/9\/download$/.test(u)) return new Response(new Uint8Array(buffer), { status: 200 });
      throw new Error(`unexpected request ${u}`);
    }) as typeof fetch;
  }

  before(() => {
    saveApiKey('brk_test-key');
  });

  after(() => {
    for (const { path: p, content } of backedUp) {
      if (content === null) rmSync(p, { force: true });
      else writeFileSync(p, content);
    }
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sync-cli-pull-issue-test-'));
    projectPath = path.join(root, 'project');
    mkdirSync(projectPath);
    const config: SyncConfig = { bridge: { apiUrl }, projects: [{ name: NAME, path: projectPath }] };
    saveConfig(config);
  });

  it('writes image and binary result assets byte for byte and lists them in ISSUE.md', async () => {
    serve(
      buildIssueArchive([{ relPath: 'src/a.ts', content: 'export const a = 1;' }], manifest, [
        { relPath: 'issue-images/shot.png', base64: pngBytes.toString('base64') },
        { relPath: 'out/result.bin', base64: binaryResult.toString('base64') },
      ]),
    );

    await pullIssueCommand(NAME, '173', '42', { force: true });

    assert.equal(readFileSync(path.join(projectPath, 'src/a.ts'), 'utf-8'), 'export const a = 1;');
    assert.deepEqual(readFileSync(path.join(projectPath, 'issue-images/shot.png')), pngBytes);
    assert.deepEqual(readFileSync(path.join(projectPath, 'out/result.bin')), binaryResult);
    const issueMd = readFileSync(path.join(projectPath, ISSUE_FILE_NAME), 'utf-8');
    assert.match(issueMd, /## Images\n\n- issue-images\/shot\.png\n/);
  });

  it('writes assets from a legacy-manifest parcel too', async () => {
    const { buffer } = buildArchive(SYNC_MANIFEST_ENTRY, [{ relPath: 'a.ts', content: 'x' }], { createdAt: 'now' }, [
      { relPath: 'out/result.bin', base64: binaryResult.toString('base64') },
    ]);
    serve(buffer);

    await pullIssueCommand(NAME, '173', '42', { force: true });

    assert.deepEqual(readFileSync(path.join(projectPath, 'out/result.bin')), binaryResult);
    assert.equal(existsSync(path.join(projectPath, ISSUE_FILE_NAME)), false);
  });

  it('rejects an asset path that escapes the project dir before writing anything', async () => {
    // adm-zip normalizes "__issue_assets__/../evil.png" to "evil.png" on addFile,
    // so put the raw entry name back by hand — the manifest's contentHash was
    // computed over "../evil.png".
    const zip = new AdmZip(
      buildIssueArchive([{ relPath: 'src/a.ts', content: 'export const a = 1;' }], manifest, [
        { relPath: '../evil.png', base64: pngBytes.toString('base64') },
      ]),
    );
    const assetEntry = zip.getEntry('evil.png');
    assert.ok(assetEntry);
    assetEntry.entryName = '__issue_assets__/../evil.png';
    serve(zip.toBuffer());

    await assert.rejects(pullIssueCommand(NAME, '173', '42', { force: true }), /escapes/);

    assert.equal(existsSync(path.join(root, 'evil.png')), false);
    assert.equal(existsSync(path.join(projectPath, 'src/a.ts')), false);
    assert.equal(existsSync(path.join(projectPath, ISSUE_FILE_NAME)), false);
  });
});
