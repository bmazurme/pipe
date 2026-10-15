import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findOwnCredentials } from './ownCredentials.js';

const dirs: string[] = [];

function tempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'own-creds-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('findOwnCredentials', () => {
  const credentials = { refreshToken: 'refresh-abc', gitlabToken: 'glpat-xyz', apiKey: 'key-123' };

  it('reports files containing each kind of stored secret', () => {
    const dir = tempDir({
      'NOTES.md': 'token: glpat-xyz',
      'sub/a.txt': 'x refresh-abc y',
      'b.txt': 'key-123',
      'clean.txt': 'nothing here',
    });

    assert.deepEqual(
      findOwnCredentials(dir, ['NOTES.md', 'sub/a.txt', 'b.txt', 'clean.txt'], credentials),
      ['NOTES.md', 'sub/a.txt', 'b.txt'],
    );
  });

  it('never matches on empty or missing credential fields', () => {
    const dir = tempDir({ 'a.txt': 'anything at all' });

    assert.deepEqual(findOwnCredentials(dir, ['a.txt'], { refreshToken: '', gitlabToken: undefined }), []);
    assert.deepEqual(findOwnCredentials(dir, ['a.txt'], {}), []);
  });

  it('does not return the secret values', () => {
    const dir = tempDir({ 'a.txt': 'glpat-xyz' });

    assert.ok(!JSON.stringify(findOwnCredentials(dir, ['a.txt'], credentials)).includes('glpat-xyz'));
  });
});
