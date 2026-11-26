import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { restrictStateDir } from './stateDirMode.js';

describe('restrictStateDir', () => {
  const dirs: string[] = [];
  const make = (mode: number) => {
    const dir = mkdtempSync(join(tmpdir(), 'state-mode-'));

    chmodSync(dir, mode);
    dirs.push(dir);

    return dir;
  };

  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('closes a directory that other users can enter, and says so', () => {
    const dir = make(0o755);

    assert.equal(restrictStateDir(dir), 'tightened');
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  });

  it('leaves an already private directory alone', () => {
    const dir = make(0o700);

    assert.equal(restrictStateDir(dir), 'already');
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  });

  it('closes group access too (0750)', () => {
    const dir = make(0o750);

    assert.equal(restrictStateDir(dir), 'tightened');
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  });

  it('does nothing for a directory that does not exist yet', () => {
    assert.equal(restrictStateDir(join(tmpdir(), 'no-such-state-dir-xyz')), 'missing');
  });
});
