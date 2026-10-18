import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { saveApiKey } from '../credentials.js';
import { saveConfig } from '../config.js';
import { buildArchive } from '../pack.js';
import { CONFIG_PATH, CREDENTIALS_PATH, STATE_PATH } from '../paths.js';
import { getLastHash, setLastHash } from '../state.js';
import type { SyncConfig } from '../types.js';
import { pullCommand } from './pull.js';

// CONFIG_PATH, CREDENTIALS_PATH and STATE_PATH are fixed paths (not
// injectable), so back them up and restore them to keep a developer's real
// files intact. Other test files touch the same paths — the "test" script's
// --test-concurrency=1 keeps the hooks from interleaving.
const originalFetch = globalThis.fetch;
const backedUp = [CONFIG_PATH, CREDENTIALS_PATH, STATE_PATH].map((p) => ({
  path: p,
  content: existsSync(p) ? readFileSync(p, 'utf-8') : null,
}));

const NAME = 'pull-test-project';
const apiUrl = 'https://bridge.example.com';

let projectPath: string;
let downloaded: number[];
let deleted: number[];

interface Listed {
  id: number;
  originalName: string;
  createdAt: string;
}

function mockBridge(listed: Listed[], buffers: Record<number, Buffer>): void {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const del = /\/storage\/(\d+)$/.exec(u);
    if (del && init?.method === 'DELETE') {
      deleted.push(Number(del[1]));
      return new Response(null, { status: 204 });
    }
    if (u.startsWith(`${apiUrl}/api/v1/storage?`) || u === `${apiUrl}/api/v1/storage`) {
      return new Response(JSON.stringify(listed), { status: 200 });
    }
    const match = /\/storage\/(\d+)\/peek$/.exec(u);
    if (match) {
      const id = Number(match[1]);
      downloaded.push(id);
      return new Response(new Uint8Array(buffers[id]), { status: 200 });
    }
    throw new Error(`unexpected request ${u}`);
  }) as typeof fetch;
}

function listing(id: number, createdAt: string, originalName = `${NAME}.sync.zip`): Listed {
  return { id, originalName, createdAt };
}

function writeConfig(dictionary?: string): void {
  const config: SyncConfig = {
    bridge: { apiUrl },
    projects: [{ name: NAME, path: projectPath, dictionary }],
  };
  saveConfig(config);
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
  projectPath = mkdtempSync(path.join(tmpdir(), 'sync-cli-pull-test-'));
  downloaded = [];
  deleted = [];
  rmSync(STATE_PATH, { force: true });
  writeConfig();
});

describe('pullCommand', () => {
  it('leaves the parcel on bridge when the zip is corrupt', async () => {
    mockBridge([listing(1, '2026-01-01T00:00:00Z')], { 1: Buffer.from('not a zip') });

    await assert.rejects(() => pullCommand(NAME, {}));

    assert.deepEqual(deleted, []);
  });

  it('returns without writing when no parcel has been pushed', async () => {
    mockBridge([listing(1, '2026-01-01T00:00:00Z', 'other.sync.zip')], {});

    await pullCommand(NAME, {});

    assert.deepEqual(downloaded, []);
    assert.equal(existsSync(path.join(projectPath, 'a.ts')), false);
    assert.equal(getLastHash(NAME), undefined);
  });

  it('downloads only the newest of several candidates', async () => {
    const older = buildArchive(NAME, [{ relPath: 'a.ts', content: 'old' }]).buffer;
    const newer = buildArchive(NAME, [{ relPath: 'a.ts', content: 'new' }]).buffer;
    mockBridge(
      [listing(1, '2026-01-01T00:00:00Z'), listing(2, '2026-03-01T00:00:00Z'), listing(3, '2026-02-01T00:00:00Z')],
      { 1: older, 2: newer, 3: older },
    );

    await pullCommand(NAME, {});

    assert.deepEqual(downloaded, [2]);
    assert.deepEqual(deleted, [2]);
    assert.equal(readFileSync(path.join(projectPath, 'a.ts'), 'utf-8'), 'new');
  });

  it('skips when the contentHash matches the last pull, unless forced', async () => {
    const { buffer, manifest } = buildArchive(NAME, [{ relPath: 'a.ts', content: 'v1' }]);
    setLastHash(NAME, manifest.contentHash);
    mockBridge([listing(1, '2026-01-01T00:00:00Z')], { 1: buffer });

    await pullCommand(NAME, {});
    assert.equal(existsSync(path.join(projectPath, 'a.ts')), false);
    assert.deepEqual(deleted, [1]);

    await pullCommand(NAME, { force: true });
    assert.equal(readFileSync(path.join(projectPath, 'a.ts'), 'utf-8'), 'v1');
  });

  it('refuses a dirty git tree unless forced', async () => {
    execFileSync('git', ['init', '-q'], { cwd: projectPath });
    writeFileSync(path.join(projectPath, 'local.txt'), 'uncommitted');
    const { buffer } = buildArchive(NAME, [{ relPath: 'a.ts', content: 'v1' }]);
    mockBridge([listing(1, '2026-01-01T00:00:00Z')], { 1: buffer });

    await assert.rejects(() => pullCommand(NAME, {}), /uncommitted changes/);
    assert.equal(existsSync(path.join(projectPath, 'a.ts')), false);
    assert.deepEqual(downloaded, []);

    await pullCommand(NAME, { force: true });
    assert.equal(readFileSync(path.join(projectPath, 'a.ts'), 'utf-8'), 'v1');
  });

  it('replaces dictionary placeholders with real values in written files', async () => {
    const dictionaryPath = path.join(projectPath, 'dict.json');
    writeFileSync(dictionaryPath, JSON.stringify({ ClearingIdentifier: '{{ENTITY}}' }));
    writeConfig(dictionaryPath);
    const { buffer } = buildArchive(NAME, [
      { relPath: 'src/a.ts', content: 'export const owner = "{{ENTITY}}";' },
    ]);
    mockBridge([listing(1, '2026-01-01T00:00:00Z')], { 1: buffer });

    await pullCommand(NAME, {});

    assert.equal(
      readFileSync(path.join(projectPath, 'src', 'a.ts'), 'utf-8'),
      'export const owner = "ClearingIdentifier";',
    );
  });

  it('records the new hash after a successful pull', async () => {
    const { buffer, manifest } = buildArchive(NAME, [{ relPath: 'a.ts', content: 'v1' }]);
    mockBridge([listing(1, '2026-01-01T00:00:00Z')], { 1: buffer });

    await pullCommand(NAME, {});

    assert.equal(getLastHash(NAME), manifest.contentHash);
  });
});
