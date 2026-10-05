import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeJsonFileSync } from './atomicWrite.js';

describe('writeJsonFileSync', () => {
  it('writes pretty-printed JSON with a trailing newline, matching the prior writeFileSync convention', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atomic-write-test-'));
    const filePath = path.join(dir, 'state.json');

    try {
      writeJsonFileSync(filePath, { a: 1, b: [2, 3] });

      const content = readFileSync(filePath, 'utf-8');
      assert.equal(content, JSON.stringify({ a: 1, b: [2, 3] }, null, 2) + '\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates the parent directory if it does not exist yet', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atomic-write-test-'));
    const filePath = path.join(dir, 'nested', 'deeper', 'state.json');

    try {
      writeJsonFileSync(filePath, { ok: true });

      assert.equal(existsSync(filePath), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves no temp file behind after a successful write', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atomic-write-test-'));
    const filePath = path.join(dir, 'state.json');

    try {
      writeJsonFileSync(filePath, { ok: true });

      assert.deepEqual(readdirSync(dir), ['state.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies a given mode to the file, e.g. for a sensitive credentials file', { skip: process.platform === 'win32' }, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atomic-write-test-'));
    const filePath = path.join(dir, 'credentials.json');

    try {
      writeJsonFileSync(filePath, { apiKey: 'secret' }, { mode: 0o600 });

      assert.equal(statSync(filePath).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('overwrites an existing file atomically (old content never partially visible)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atomic-write-test-'));
    const filePath = path.join(dir, 'state.json');

    try {
      writeJsonFileSync(filePath, { version: 1 });
      writeJsonFileSync(filePath, { version: 2 });

      assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf-8')), { version: 2 });
      assert.deepEqual(readdirSync(dir), ['state.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
