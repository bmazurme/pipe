import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeParcelFiles } from './writeParcelFiles.js';

describe('writeParcelFiles', () => {
  it('writes nested files and names that merely start with dots', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'parcel-ok-'));
    writeParcelFiles(root, [
      { relPath: 'a/b.txt', content: '1' },
      { relPath: '..foo', content: '2' },
    ]);
    assert.equal(readFileSync(path.join(root, 'a', 'b.txt'), 'utf-8'), '1');
    assert.equal(readFileSync(path.join(root, '..foo'), 'utf-8'), '2');
  });

  it('rejects an escaping entry and writes nothing, even for earlier valid entries', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'parcel-bad-'));
    const root = path.join(base, 'project');
    for (const bad of ['../x', 'a/../../x', path.join(base, 'abs.txt')]) {
      assert.throws(
        () =>
          writeParcelFiles(root, [
            { relPath: 'ok.txt', content: 'fine' },
            { relPath: bad, content: 'bad' },
          ]),
        /escapes|Absolute/,
      );
    }
    assert.equal(existsSync(path.join(base, 'x')), false);
    assert.equal(existsSync(path.join(base, 'abs.txt')), false);
    assert.equal(existsSync(path.join(root, 'ok.txt')), false);
  });

  it('rejects an entry inside .git and writes nothing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'parcel-git-'));
    for (const bad of ['.git/config', 'sub/.GIT/hooks/pre-commit']) {
      assert.throws(
        () =>
          writeParcelFiles(root, [
            { relPath: 'ok.txt', content: 'fine' },
            { relPath: bad, content: 'bad' },
          ]),
        /Path inside \.git is not allowed/,
      );
    }
    assert.equal(existsSync(path.join(root, '.git')), false);
    assert.equal(existsSync(path.join(root, 'sub')), false);
    assert.equal(existsSync(path.join(root, 'ok.txt')), false);
  });

  it('refuses to write through an existing directory symlink and writes nothing', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'parcel-link-'));
    const root = path.join(base, 'project');
    const outside = path.join(base, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    symlinkSync(outside, path.join(root, 'link'), 'dir');

    assert.throws(
      () =>
        writeParcelFiles(root, [
          { relPath: 'ok.txt', content: 'fine' },
          { relPath: 'link/a.txt', content: 'bad' },
        ]),
      /Path goes through a symlink: link/,
    );
    assert.equal(existsSync(path.join(outside, 'a.txt')), false);
    assert.equal(existsSync(path.join(root, 'ok.txt')), false);
  });
});
