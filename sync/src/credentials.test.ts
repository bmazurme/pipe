import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadCredentials, loadCredentialsOrEmpty, saveApiKey, saveGitlabToken } from './credentials.js';

const dirs: string[] = [];

function tempFile(content?: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sync-creds-'));
  dirs.push(dir);
  const file = path.join(dir, 'credentials.json');
  if (content !== undefined) writeFileSync(file, content);
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('credentials file', () => {
  it('names the file and the fix when the JSON is corrupt', () => {
    const file = tempFile('{"refreshToken": "ab');
    for (const load of [loadCredentials, loadCredentialsOrEmpty]) {
      assert.throws(
        () => load(file),
        (err: Error) => err.message.includes(file) && err.message.includes('sync-cli login'),
      );
    }
  });

  it('keeps the old messages for a missing file', () => {
    const file = tempFile();
    assert.throws(() => loadCredentials(file), /Not logged in/);
    assert.deepEqual(loadCredentialsOrEmpty(file), {});
  });

  it('does not overwrite a corrupt file when saving', () => {
    const file = tempFile('{oops');
    assert.throws(() => saveGitlabToken('glpat', file), /not valid JSON/);
    assert.equal(readFileSync(file, 'utf-8'), '{oops');
  });

  it('saveGitlabToken and saveApiKey keep the other stored fields', () => {
    const file = tempFile(JSON.stringify({ refreshToken: 'r', gitlabToken: 'g', apiKey: 'k' }));
    saveGitlabToken('g2', file);
    assert.deepEqual(loadCredentials(file), { refreshToken: 'r', gitlabToken: 'g2', apiKey: 'k' });
    saveApiKey('k2', file);
    assert.deepEqual(loadCredentials(file), { refreshToken: 'r', gitlabToken: 'g2', apiKey: 'k2' });
  });
});
