import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resolveFileSecrets } from './secrets.js';

describe('resolveFileSecrets', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'secrets-test-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the file and trims it', () => {
    const file = join(dir, 'key');
    writeFileSync(file, '  s3cret\n');
    const env: NodeJS.ProcessEnv = { FOO_KEY_FILE: file };
    resolveFileSecrets(env, ['FOO_KEY']);
    assert.equal(env.FOO_KEY, 's3cret');
  });

  it('lets a plain env value win without reading the file', () => {
    const env: NodeJS.ProcessEnv = { FOO_KEY: 'plain', FOO_KEY_FILE: join(dir, 'does-not-exist') };
    resolveFileSecrets(env, ['FOO_KEY']);
    assert.equal(env.FOO_KEY, 'plain');
  });

  it('skips a key whose _FILE is unset', () => {
    const env: NodeJS.ProcessEnv = {};
    resolveFileSecrets(env, ['FOO_KEY']);
    assert.equal(env.FOO_KEY, undefined);
  });

  it('names the key and path when the file is missing', () => {
    const file = join(dir, 'missing');
    const env: NodeJS.ProcessEnv = { FOO_KEY_FILE: file };
    assert.throws(
      () => resolveFileSecrets(env, ['FOO_KEY']),
      (err: Error) => err.message.includes('FOO_KEY_FILE') && err.message.includes(file),
    );
  });

  it('throws on an empty or whitespace-only file', () => {
    const file = join(dir, 'empty');
    writeFileSync(file, ' \n\t\n');
    const env: NodeJS.ProcessEnv = { FOO_KEY_FILE: file };
    assert.throws(() => resolveFileSecrets(env, ['FOO_KEY']), /FOO_KEY_FILE .* is empty/);
    assert.equal(env.FOO_KEY, undefined);
  });
});
