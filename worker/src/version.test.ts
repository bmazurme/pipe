import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { workerVersion } from './version.js';

describe('workerVersion', () => {
  const withManifest = (content: string, run: (url: URL) => void) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ver-'));

    try {
      const file = path.join(dir, 'package.json');

      writeFileSync(file, content);
      run(pathToFileURL(file));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('reads the version from package.json', () => {
    withManifest('{"version":"1.2.3"}', (url) => assert.equal(workerVersion(url), '1.2.3'));
  });

  it('is "unknown" — never an exception — when the manifest is missing, broken or has no version', () => {
    assert.equal(workerVersion(pathToFileURL('/nonexistent/package.json')), 'unknown');
    withManifest('not json', (url) => assert.equal(workerVersion(url), 'unknown'));
    withManifest('{}', (url) => assert.equal(workerVersion(url), 'unknown'));
    withManifest('{"version":3}', (url) => assert.equal(workerVersion(url), 'unknown'));
  });

  it('reads this package’s real version by default', () => {
    assert.match(workerVersion(), /^\d+\.\d+\.\d+/);
  });
});
