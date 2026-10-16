import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, resolveProjectGlobs, walkProjectFiles } from './walk.js';

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

  it('returns dotfiles only when an include pattern names the dot segment explicitly', async () => {
    const result = await walkProjectFiles(root, ['.env.example', '.github/**'], []);
    assert.deepEqual(result.sort(), ['.env.example', '.github/workflows/ci.yml']);
  });

  it('skips symlinks to files and does not descend into symlinked directories', async () => {
    const result = await walkProjectFiles(root, ['**/*'], ['node_modules/**']);
    assert.ok(!result.includes('src/link-to-file.ts'));
    assert.ok(!result.some((f) => f.startsWith('linked-dir/')));
    assert.deepEqual(result.sort(), ['README.md', 'src/a.ts', 'src/nested/b.ts']);
  });
});

describe('resolveProjectGlobs', () => {
  it('uses the project\'s own globs when it has them', () => {
    assert.deepEqual(resolveProjectGlobs({ include: ['src/**'], exclude: ['**/x/**'] }), { include: ['src/**'], exclude: ['**/x/**'] });
  });

  it('falls back to the defaults for missing, null and EMPTY arrays alike', () => {
    for (const project of [{}, { include: undefined, exclude: undefined }, { include: null, exclude: null }, { include: [], exclude: [] }]) {
      assert.deepEqual(resolveProjectGlobs(project), { include: [...DEFAULT_INCLUDE], exclude: [...DEFAULT_EXCLUDE] });
    }
  });

  it('decides each side on its own', () => {
    assert.deepEqual(resolveProjectGlobs({ include: ['a/**'], exclude: [] }), { include: ['a/**'], exclude: [...DEFAULT_EXCLUDE] });
    assert.deepEqual(resolveProjectGlobs({ include: [], exclude: ['b/**'] }), { include: [...DEFAULT_INCLUDE], exclude: ['b/**'] });
  });

  it('hands out copies, so a caller cannot change the defaults', () => {
    const first = resolveProjectGlobs({});

    first.include.push('**/*.evil');
    first.exclude.length = 0;

    assert.deepEqual(resolveProjectGlobs({}), { include: [...DEFAULT_INCLUDE], exclude: [...DEFAULT_EXCLUDE] });
  });

  it('keeps node_modules and .git out of the defaults\' parcel', () => {
    assert.ok(DEFAULT_EXCLUDE.includes('**/node_modules/**'));
    assert.ok(DEFAULT_EXCLUDE.includes('**/.git/**'));
  });
});
