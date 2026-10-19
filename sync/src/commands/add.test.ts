import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CONFIG_PATH } from '../paths.js';
import { addCommand, assertProjectPaths } from './add.js';

describe('assertProjectPaths', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'add-test-'));
    writeFileSync(path.join(dir, 'file.txt'), 'x');
    writeFileSync(path.join(dir, 'dict.json'), '{}');
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('accepts a directory without a dictionary', () => {
    assert.doesNotThrow(() => assertProjectPaths('p', dir));
  });

  it('accepts a directory with an existing dictionary', () => {
    assert.doesNotThrow(() => assertProjectPaths('p', dir, path.join(dir, 'dict.json')));
  });

  it('rejects a missing path, naming it', () => {
    const missing = path.join(dir, 'nope');
    assert.throws(() => assertProjectPaths('p', missing), (e: Error) => e.message.includes(missing) && /does not exist/.test(e.message));
  });

  it('rejects a file path', () => {
    const file = path.join(dir, 'file.txt');
    assert.throws(() => assertProjectPaths('p', file), (e: Error) => e.message.includes(file) && /not a directory/.test(e.message));
  });

  it('rejects a missing dictionary, naming its resolved path', () => {
    const dict = path.join(dir, 'missing-dict.json');
    assert.throws(() => assertProjectPaths('p', dir, dict), (e: Error) => e.message.includes(dict));
  });
});

describe('addCommand', () => {
  // CONFIG_PATH is fixed, so back it up and restore it (see pushIssue.test.ts).
  const original = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, 'utf-8') : null;
  let dir: string;

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'add-test-'));
    writeFileSync(CONFIG_PATH, JSON.stringify({ projects: [] }));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
    if (original === null) rmSync(CONFIG_PATH, { force: true });
    else writeFileSync(CONFIG_PATH, original);
  });

  it('rejects a bad path without changing the config, and rejects duplicate names', () => {
    const before = readFileSync(CONFIG_PATH, 'utf-8');
    assert.throws(() => addCommand('x', path.join(dir, 'nope')), /does not exist/);
    assert.equal(readFileSync(CONFIG_PATH, 'utf-8'), before);

    addCommand('x', dir);
    assert.throws(() => addCommand('x', dir), /already tracked/);
  });
});
