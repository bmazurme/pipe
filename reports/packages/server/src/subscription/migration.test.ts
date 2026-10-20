import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ migrations: [] as unknown[] }));
vi.mock('./config-props', () => ({
  findMigration: (id: string) => (state.migrations as { id: string }[]).find((item) => item.id === id),
  addMigration: (migration: Record<string, unknown>) => ({ id: '4000000001', ...migration }),
}));

import { collectMigrationFiles, countMigrationFiles, migrationTitle, requireMigration, targetFilesOf, validateMigration } from './migration';

const folder = (name: string, files: Record<string, string> = {}, { git = false } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), `reports-mig-${name}-`));

  if (git) mkdirSync(join(dir, '.git'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }

  return dir;
};

describe('validateMigration', () => {
  it('accepts two separate folders, the target being a git repository, and normalises what was typed', () => {
    const source = folder('src');
    const target = folder('dst', {}, { git: true });

    const valid = validateMigration({
      name: '  CRM → Nest  ',
      sourcePath: source,
      sourceInclude: [' **/*.cs ', ''],
      targetPath: target,
      targetBaseBranch: ' develop ',
      targetExclude: [],
    });

    expect(valid).toMatchObject({ name: 'CRM → Nest', sourcePath: source, sourceInclude: ['**/*.cs'], targetPath: target, targetBaseBranch: 'develop' });
    expect(valid.targetExclude).toBeUndefined();
  });

  it('says what is wrong: no name, a missing folder, the same folder, a target that is not a git repository, one inside the other', () => {
    const source = folder('src');
    const target = folder('dst', {}, { git: true });
    const input = { name: 'm', sourcePath: source, targetPath: target };

    expect(() => validateMigration({ ...input, name: ' ' })).toThrow(/название/);
    expect(() => validateMigration({ ...input, sourcePath: join(source, 'nope') })).toThrow(/Текущий репозиторий не найден/);
    expect(() => validateMigration({ ...input, targetPath: '' })).toThrow(/Целевой репозиторий не найден/);
    expect(() => validateMigration({ ...input, targetPath: source })).toThrow(/одна и та же папка/);
    expect(() => validateMigration({ ...input, targetPath: folder('plain') })).toThrow(/не git-репозиторий/);

    const outer = folder('outer');
    const inner = join(outer, 'inner');
    mkdirSync(join(inner, '.git'), { recursive: true });
    expect(() => validateMigration({ name: 'm', sourcePath: outer, targetPath: inner })).toThrow(/внутри другого/);
  });
});

describe('collectMigrationFiles', () => {
  const migration = (source: string, target: string) => ({
    id: '4000000001',
    name: 'm',
    sourcePath: source,
    sourceInclude: ['**/*.cs'],
    targetPath: target,
    targetInclude: ['**/*.ts'],
  });

  it('puts the current repository under source/ and the target under target/, each by its own globs, anonymized', async () => {
    const source = folder('src', { 'Orders/Order.cs': 'class Order { /* ACME-secret */ }', 'readme.md': 'not a .cs file' });
    const target = folder('dst', { 'src/orders.ts': 'export const orders = 1;', 'src/other.cs': 'not a .ts file' }, { git: true });

    const result = await collectMigrationFiles(migration(source, target), [{ key: 'ACME-secret', value: 'PLACEHOLDER' }]);

    expect(result.files.map((file) => file.relPath).sort()).toEqual(['source/Orders/Order.cs', 'target/src/orders.ts']);
    expect(result).toMatchObject({ sourceFiles: 1, targetFiles: 1 });
    expect(result.files.find((file) => file.relPath === 'source/Orders/Order.cs')?.content).toContain('PLACEHOLDER');
    expect(result.files.find((file) => file.relPath === 'source/Orders/Order.cs')?.content).not.toContain('ACME-secret');
  });

  it('refuses a current repository with nothing to move, but lets the target be empty (a brand-new repository)', async () => {
    const empty = folder('empty');
    const target = folder('dst', {}, { git: true });

    await expect(collectMigrationFiles(migration(empty, target), [])).rejects.toThrow(/переносить нечего/);

    const source = folder('src', { 'a.cs': 'class A {}' });
    await expect(collectMigrationFiles(migration(source, target), [])).resolves.toMatchObject({ sourceFiles: 1, targetFiles: 0 });
  });

  it('counts the two sides without reading them into a parcel', async () => {
    const source = folder('src', { 'a.cs': '1', 'b.cs': '2' });
    const target = folder('dst', { 'x.ts': '3' }, { git: true });

    expect(await countMigrationFiles(migration(source, target))).toEqual({ sourceFiles: 2, targetFiles: 1 });
  });
});

describe('the small helpers', () => {
  it('names a task by its first line when no name was given', () => {
    expect(migrationTitle('Перенести модуль Orders\nподробности', undefined)).toBe('Миграция: Перенести модуль Orders');
    expect(migrationTitle('x'.repeat(200))).toMatch(/^Миграция: x{77}…$/);
    expect(migrationTitle('anything', '  Свой заголовок ')).toBe('Свой заголовок');
    expect(migrationTitle('   ')).toBe('Миграция: без названия');
  });

  it('takes only target/… from a result, without the prefix', () => {
    expect(
      targetFilesOf([
        { relPath: 'source/a.cs', content: 'x' },
        { relPath: 'target/src/a.ts', content: 'y' },
        { relPath: 'other.txt', content: 'z' },
      ]),
    ).toEqual([{ relPath: 'src/a.ts', content: 'y' }]);
  });

  it('says a migration is missing when it is not in the settings', () => {
    state.migrations = [{ id: '4000000009', name: 'there' }];

    expect(requireMigration('4000000009')).toMatchObject({ name: 'there' });
    expect(() => requireMigration('4000000010')).toThrow(/Миграция не найдена/);
  });
});
