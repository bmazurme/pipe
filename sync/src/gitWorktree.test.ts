import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { commitAll } from './gitWorktree.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sync-cli-gitworktree-test-'));
  git(dir, ['init', '--quiet']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  writeFileSync(path.join(dir, 'README.md'), 'placeholder');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'initial', '--quiet']);
  return dir;
}

// Stands in for husky/lint-staged: a real pre-commit hook that only
// succeeds if node_modules/.bin's own tool is present at commit time.
function installPreCommitHookRequiringNodeModules(dir: string): void {
  const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
  writeFileSync(
    hookPath,
    '#!/bin/sh\ntest -f node_modules/.bin/marker || { echo "marker tool not found" >&2; exit 1; }\n',
  );
  chmodSync(hookPath, 0o755);
}

function writeFakeNodeModules(dir: string): void {
  mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(path.join(dir, 'node_modules', '.bin', 'marker'), '#!/bin/sh\n');
}

describe('commitAll', () => {
  it('leaves node_modules in place (and a hook that needs it succeeds) when the repo already gitignores it', () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'add gitignore', '--quiet']);

    writeFakeNodeModules(dir);
    installPreCommitHookRequiringNodeModules(dir);

    // Would throw (execFileSync rejects on the hook's nonzero exit) if
    // node_modules got stripped before the hook ran.
    assert.doesNotThrow(() => commitAll(dir, 'test commit'));
    assert.equal(existsSync(path.join(dir, 'node_modules', '.bin', 'marker')), true);
  });

  it('still strips node_modules when the repo has no .gitignore entry for it', () => {
    const dir = initRepo();
    writeFakeNodeModules(dir);

    commitAll(dir, 'test commit');

    assert.equal(existsSync(path.join(dir, 'node_modules')), false);
  });

  it('strips dist/build/coverage the same way, only when not already gitignored', () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, '.gitignore'), 'dist\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'add gitignore', '--quiet']);

    mkdirSync(path.join(dir, 'dist'), { recursive: true });
    writeFileSync(path.join(dir, 'dist', 'out.js'), '');
    mkdirSync(path.join(dir, 'coverage'), { recursive: true });
    writeFileSync(path.join(dir, 'coverage', 'index.html'), '');

    commitAll(dir, 'test commit');

    assert.equal(existsSync(path.join(dir, 'dist')), true, 'dist is gitignored, should survive');
    assert.equal(existsSync(path.join(dir, 'coverage')), false, 'coverage is not gitignored, should be stripped');
  });
});
