import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listFilesRecursively } from './fsWalk.js';

describe('listFilesRecursively', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fswalk-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns nested files as paths relative to the root', () => {
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    writeFileSync(join(root, 'top.txt'), '1');
    writeFileSync(join(root, 'a', 'mid.txt'), '2');
    writeFileSync(join(root, 'a', 'b', 'deep.txt'), '3');

    assert.deepEqual(listFilesRecursively(root).sort(), [
      join('a', 'b', 'deep.txt'),
      join('a', 'mid.txt'),
      'top.txt',
    ]);
  });

  it('lists nothing for empty directories', () => {
    mkdirSync(join(root, 'empty', 'inner'), { recursive: true });

    assert.deepEqual(listFilesRecursively(root), []);
  });

  it('skips file and directory symlinks', () => {
    mkdirSync(join(root, 'dir'));
    writeFileSync(join(root, 'dir', 'real.txt'), 'x');
    writeFileSync(join(root, 'file.txt'), 'x');
    symlinkSync(join(root, 'file.txt'), join(root, 'file-link'));
    symlinkSync(join(root, 'dir'), join(root, 'dir-link'));

    assert.deepEqual(listFilesRecursively(root).sort(), [join('dir', 'real.txt'), 'file.txt']);
  });

  it('does not follow a symlink loop', () => {
    writeFileSync(join(root, 'a.txt'), 'x');
    symlinkSync('.', join(root, 'loop'));

    assert.deepEqual(listFilesRecursively(root), ['a.txt']);
  });

  it('uses the cwd argument as the prefix base', () => {
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'sub', 'f.txt'), 'x');

    assert.deepEqual(listFilesRecursively(join(root, 'sub'), root), [join('sub', 'f.txt')]);
  });

  it('lists dotfiles and .claude/ files — exclusion happens in index.ts, not here', () => {
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.env'), 'x');
    writeFileSync(join(root, '.claude', 'settings.json'), '{}');

    assert.deepEqual(listFilesRecursively(root).sort(), [join('.claude', 'settings.json'), '.env']);
  });
});
