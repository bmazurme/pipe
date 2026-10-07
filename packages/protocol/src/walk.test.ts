import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { walkProjectFiles } from './walk.js';

describe('walkProjectFiles', () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'walk-test-'));
    const files = [
      'src/a.ts',
      'src/nested/b.ts',
      'README.md',
      'node_modules/pkg/index.js',
      '.env.example',
      '.gitlab-ci.yml',
      '.eslintrc',
      '.github/workflows/ci.yml',
      'src/.hidden.ts',
    ];
    for (const f of files) {
      await mkdir(path.dirname(path.join(root, f)), { recursive: true });
      await writeFile(path.join(root, f), 'x');
    }
    await symlink(path.join(root, 'src/a.ts'), path.join(root, 'src/link-to-file.ts'));
    await symlink(path.join(root, 'src'), path.join(root, 'linked-dir'));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns files matching the include patterns', async () => {
    const result = await walkProjectFiles(root, ['src/**/*.ts'], []);
    assert.deepEqual(result.sort(), ['src/a.ts', 'src/nested/b.ts']);
  });

  it('removes files matching the exclude patterns', async () => {
    const result = await walkProjectFiles(root, ['**/*'], ['node_modules/**', '**/nested/**']);
    assert.deepEqual(result.sort(), ['README.md', 'src/a.ts']);
  });

  it('skips dotfiles and dot-directories', async () => {
    const result = await walkProjectFiles(root, ['**/*'], []);
    for (const skipped of ['.env.example', '.gitlab-ci.yml', '.eslintrc', '.github/workflows/ci.yml', 'src/.hidden.ts']) {
      assert.ok(!result.includes(skipped), `${skipped} should not be returned`);
    }
  });

  it('skips dotfiles even when an include pattern names them explicitly', async () => {
    const result = await walkProjectFiles(root, ['.env.example', '.github/**'], []);
    assert.deepEqual(result, []);
  });

  it('skips symlinks to files and does not descend into symlinked directories', async () => {
    const result = await walkProjectFiles(root, ['**/*'], ['node_modules/**']);
    assert.ok(!result.includes('src/link-to-file.ts'));
    assert.ok(!result.some((f) => f.startsWith('linked-dir/')));
    assert.deepEqual(result.sort(), ['README.md', 'src/a.ts', 'src/nested/b.ts']);
  });
});
