import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { assertNoSymlinkOnPath, resolveInDir } from './resolveInDir.js';

const root = path.resolve('/tmp/protocol-root');

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

test('rejects paths inside a .git directory, case-insensitively and on either separator', () => {
  assert.throws(() => resolveInDir(root, '.git/config'), /Path inside \.git is not allowed: \.git\/config/);
  assert.throws(() => resolveInDir(root, 'a/.Git/hooks/pre-commit'), /inside \.git/);
  assert.throws(() => resolveInDir(root, 'sub/.GIT/hooks/x'), /inside \.git/);
  assert.throws(() => resolveInDir(root, 'sub\\.git\\hooks\\x'), /inside \.git/);
  assert.throws(() => resolveInDir(root, '.git'), /inside \.git/);
  assert.throws(() => resolveInDir(root, '.git./config'), /inside \.git/);
});

test('still allows names that merely start with .git', () => {
  assert.equal(resolveInDir(root, '.gitignore'), path.join(root, '.gitignore'));
  assert.equal(resolveInDir(root, '.github/x.yml'), path.join(root, '.github', 'x.yml'));
  assert.equal(resolveInDir(root, 'docs/.gitkeep'), path.join(root, 'docs', '.gitkeep'));
});

test('assertNoSymlinkOnPath refuses a path through a symlinked directory', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'symlink-check-'));
  const outside = path.join(base, 'outside');
  const projectRoot = path.join(base, 'project');
  mkdirSync(outside);
  mkdirSync(path.join(projectRoot, 'plain'), { recursive: true });
  symlinkSync(outside, path.join(projectRoot, 'link'), 'dir');

  assert.throws(
    () => assertNoSymlinkOnPath(projectRoot, path.join(projectRoot, 'link', 'a.txt')),
    /Path goes through a symlink: link/,
  );
  assert.doesNotThrow(() => assertNoSymlinkOnPath(projectRoot, path.join(projectRoot, 'plain', 'a.txt')));
  assert.doesNotThrow(() => assertNoSymlinkOnPath(projectRoot, path.join(projectRoot, 'new', 'deep', 'a.txt')));
});
