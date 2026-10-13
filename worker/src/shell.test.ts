import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findShell, requireShell } from './shell.js';

const only = (...present: string[]) => (file: string) => present.includes(file);

describe('findShell', () => {
  it('finds bash in the first PATH entry that has one', () => {
    assert.equal(findShell('/usr/local/bin:/bin', only('/bin/bash')), '/bin/bash');
  });

  it('falls back to zsh when there is no bash', () => {
    assert.equal(findShell('/bin', only('/bin/zsh')), '/bin/zsh');
  });

  it('prefers bash over zsh in the same directory', () => {
    assert.equal(findShell('/bin', only('/bin/zsh', '/bin/bash')), '/bin/bash');
  });

  it('returns null on a busybox-only image (sh is not enough for Claude Code)', () => {
    assert.equal(findShell('/usr/local/bin:/usr/bin:/bin', only('/bin/sh', '/bin/ash')), null);
  });

  it('ignores empty PATH entries', () => {
    assert.equal(findShell('::/bin:', only('/bin/bash')), '/bin/bash');
  });
});

describe('requireShell', () => {
  it('returns the shell it found', () => {
    assert.equal(requireShell('/bin', only('/bin/bash')), '/bin/bash');
  });

  it('throws an explanation that names the consequence and the fix when there is none', () => {
    assert.throws(
      () => requireShell('/bin', only('/bin/sh')),
      /No bash or zsh on PATH.*linter or the tests.*includes bash/s,
    );
  });
});
