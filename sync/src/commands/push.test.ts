import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BridgeClient } from '../bridgeClient.js';
import { saveConfig } from '../config.js';
import { CONFIG_PATH, CREDENTIALS_PATH, STATE_PATH } from '../paths.js';
import { getLastHash } from '../state.js';
import type { SyncConfig } from '../types.js';
import { pushCommand } from './push.js';

// CONFIG_PATH, CREDENTIALS_PATH and STATE_PATH are fixed paths (not
// injectable), so back them up and restore them to keep a developer's real
// files intact. Other test files touch the same paths — the "test" script's
// --test-concurrency=1 keeps the hooks from interleaving.
const backedUp = [CONFIG_PATH, CREDENTIALS_PATH, STATE_PATH].map((p) => ({
  path: p,
  content: existsSync(p) ? readFileSync(p, 'utf-8') : null,
}));

const NAME = 'push-test-project';

let projectPath: string;
let uploads: string[];
let uploadImpl: () => Promise<{ id: number; size: number }>;

function writeConfig(): void {
  const config: SyncConfig = {
    bridge: { apiUrl: 'https://bridge.example.com' },
    projects: [{ name: NAME, path: projectPath, include: ['**/*.ts'] }],
  };
  saveConfig(config);
}

before(() => {
  // Replace the network call; nothing in these tests reaches a real bridge.
  mock.method(BridgeClient.prototype, 'upload', async (filename: string) => {
    uploads.push(filename);
    return uploadImpl();
  });
});

after(() => {
  mock.restoreAll();
  for (const { path: p, content } of backedUp) {
    if (content === null) rmSync(p, { force: true });
    else writeFileSync(p, content);
  }
});

beforeEach(() => {
  projectPath = mkdtempSync(path.join(tmpdir(), 'sync-cli-push-test-'));
  uploads = [];
  uploadImpl = async () => ({ id: 7, size: 123 });
  rmSync(STATE_PATH, { force: true });
  writeConfig();
});

afterEach(() => {
  rmSync(projectPath, { recursive: true, force: true });
});

const LEAK = 'const contact = "oncall@acme-corp.example";';

describe('pushCommand', () => {
  it('--strict aborts with an error and does not upload when the leak scan finds something', async () => {
    writeFileSync(path.join(projectPath, 'a.ts'), LEAK);

    await assert.rejects(pushCommand(NAME, { strict: true }), /--strict/);

    assert.equal(uploads.length, 0);
    assert.equal(getLastHash(NAME), undefined);
  });

  it('without --strict, a leak finding only warns and the upload still proceeds', async () => {
    writeFileSync(path.join(projectPath, 'a.ts'), LEAK);

    await pushCommand(NAME, {});

    assert.deepEqual(uploads, [`${NAME}.sync.zip`]);
    assert.ok(getLastHash(NAME));
  });

  it('skips the upload when the content is unchanged since the last push', async () => {
    writeFileSync(path.join(projectPath, 'a.ts'), 'export const a = 1;');

    await pushCommand(NAME, {});
    await pushCommand(NAME, {});

    assert.equal(uploads.length, 1);
  });

  it('--force uploads even when the content is unchanged', async () => {
    writeFileSync(path.join(projectPath, 'a.ts'), 'export const a = 1;');

    await pushCommand(NAME, {});
    await pushCommand(NAME, { force: true });

    assert.equal(uploads.length, 2);
  });

  it('leaves the stored hash unchanged when the upload rejects', async () => {
    writeFileSync(path.join(projectPath, 'a.ts'), 'export const a = 1;');
    await pushCommand(NAME, {});
    const hashBefore = getLastHash(NAME);
    assert.ok(hashBefore);

    writeFileSync(path.join(projectPath, 'a.ts'), 'export const a = 2;');
    uploadImpl = async () => {
      throw new Error('bridge down');
    };

    await assert.rejects(pushCommand(NAME, {}), /bridge down/);

    assert.equal(uploads.length, 2);
    assert.equal(getLastHash(NAME), hashBefore);
  });

  it('returns without uploading when no files match', async () => {
    await pushCommand(NAME, {});

    assert.equal(uploads.length, 0);
    assert.equal(getLastHash(NAME), undefined);
  });

  describe('--dry-run', () => {
    async function capture(fn: () => Promise<void>): Promise<string> {
      const lines: string[] = [];
      const push = (...a: unknown[]): void => void lines.push(a.join(' '));
      const logSpy = mock.method(console, 'log', push);
      const warnSpy = mock.method(console, 'warn', push);
      try {
        await fn();
      } finally {
        logSpy.mock.restore();
        warnSpy.mock.restore();
      }
      return lines.join('\n');
    }

    it('does not upload and does not store the hash', async () => {
      writeFileSync(path.join(projectPath, 'a.ts'), 'export const a = 1;');

      await pushCommand(NAME, { dryRun: true });

      assert.equal(uploads.length, 0);
      assert.equal(getLastHash(NAME), undefined);
    });

    it('reports file count, size, changed state and leak findings', async () => {
      writeFileSync(path.join(projectPath, 'a.ts'), LEAK);

      const out = await capture(() => pushCommand(NAME, { dryRun: true }));

      assert.match(out, /Files: 1/);
      assert.match(out, /Archive size: \d+ bytes/);
      assert.match(out, /Changed since the last push/);
      assert.match(out, /Leak findings: [1-9]/);
      assert.match(out, /a\.ts/);
    });

    it('says unchanged when the hash matches the last push', async () => {
      writeFileSync(path.join(projectPath, 'a.ts'), 'export const a = 1;');
      await pushCommand(NAME, {});

      const out = await capture(() => pushCommand(NAME, { dryRun: true }));

      assert.match(out, /Unchanged since the last push/);
      assert.equal(uploads.length, 1);
    });

    it('--dry-run --strict still fails on a leak', async () => {
      writeFileSync(path.join(projectPath, 'a.ts'), LEAK);

      await assert.rejects(pushCommand(NAME, { dryRun: true, strict: true }), /--strict/);
      assert.equal(uploads.length, 0);
    });

    it('prints the same "No files matched" message and uploads nothing', async () => {
      const out = await capture(() => pushCommand(NAME, { dryRun: true }));

      assert.match(out, /No files matched/);
      assert.equal(uploads.length, 0);
      assert.equal(getLastHash(NAME), undefined);
    });
  });
});
