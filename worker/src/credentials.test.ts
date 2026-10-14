import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { clearCredentials, credentialsPath, loadCredentials, saveCredentials, type StoredCredentials } from './credentials.js';

const creds: StoredCredentials = {
  bridgeApiUrl: 'https://bridge.example.com',
  workerId: 5,
  name: 'green',
  key: 'brw_secretkey',
  enrolledAt: '2026-10-14T12:00:00.000Z',
};

describe('stored worker credentials', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'creds-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips, creating the state directory on demand', () => {
    const state = path.join(dir, 'nested', 'state');

    saveCredentials(state, creds);

    assert.deepEqual(loadCredentials(state, creds.bridgeApiUrl), creds);
  });

  it('the file is readable only by its owner (0600), and no temporary copy is left behind', () => {
    saveCredentials(dir, creds);

    assert.equal(statSync(credentialsPath(dir)).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(dir), ['credentials.json']);
  });

  it('is null when nothing has been stored', () => {
    assert.equal(loadCredentials(dir, creds.bridgeApiUrl), null);
  });

  it('ignores credentials that belong to another bridge — a moved worker enrols again', () => {
    saveCredentials(dir, creds);

    assert.equal(loadCredentials(dir, 'https://other-bridge.example.com'), null);
  });

  for (const [what, content] of [
    ['not JSON', 'oops'],
    ['an empty object', '{}'],
    ['a key that is not a worker key', JSON.stringify({ ...creds, key: 'brk_personal' })],
    ['no name', JSON.stringify({ ...creds, name: undefined })],
  ] as const) {
    it(`treats ${what} as no credentials, never as a crash`, () => {
      writeFileSync(credentialsPath(dir), content);

      assert.equal(loadCredentials(dir, creds.bridgeApiUrl), null);
    });
  }

  it('forgets them on request, and forgetting twice is fine', () => {
    saveCredentials(dir, creds);
    clearCredentials(dir);
    clearCredentials(dir);

    assert.equal(existsSync(credentialsPath(dir)), false);
  });
});
