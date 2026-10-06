import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { resolveInDir } from './resolveInDir.js';

const root = path.resolve('/tmp/worker-root');

test('resolves a normal nested path inside root', () => {
  assert.equal(resolveInDir(root, 'a/b/c.txt'), path.join(root, 'a', 'b', 'c.txt'));
});

test('allows file names that merely start with two dots', () => {
  assert.equal(resolveInDir(root, '..foo'), path.join(root, '..foo'));
  assert.equal(resolveInDir(root, 'dir/..foo/bar'), path.join(root, 'dir', '..foo', 'bar'));
});

test('allows .. that stays inside root', () => {
  assert.equal(resolveInDir(root, 'a/../b'), path.join(root, 'b'));
});

test('rejects paths that escape root', () => {
  assert.throws(() => resolveInDir(root, 'a/../../b'), /escapes/);
  assert.throws(() => resolveInDir(root, '../escape.txt'), /escapes/);
  assert.throws(() => resolveInDir(root, '..'), /escapes/);
});

test('rejects absolute paths, even ones inside root', () => {
  assert.throws(() => resolveInDir(root, '/etc/x'), /Absolute/);
  assert.throws(() => resolveInDir(root, path.join(root, 'a.txt')), /Absolute/);
});
