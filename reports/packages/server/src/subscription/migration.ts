import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

import type { MigrationProjectType } from '@reports/shared';

import { applyDictionary } from './dictionary';
import { findMigration, addMigration } from './config-props';
import { walkProjectFiles } from './walk';

// How the two repositories are laid out in a migration parcel: the current one under source/, the target under target/.
export const SOURCE_PREFIX = 'source/';
export const TARGET_PREFIX = 'target/';

export function requireMigration(id: string | number): MigrationProjectType {
  const migration = findMigration(id);

  if (!migration) {
    throw new Error('Миграция не найдена: добавьте её в Settings → Миграции');
  }

  return migration;
}

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const cleanList = (list?: string[]): string[] | undefined => {
  const items = (list ?? []).map((item) => item.trim()).filter(Boolean);

  return items.length > 0 ? items : undefined;
};

// What is checked when a migration is added: the two folders exist and differ, the target is a git repository (the task branch
// and the unpacked result live there), and the current one is not inside the target or the other way round (a copy of one into the other).
export function validateMigration(input: Omit<MigrationProjectType, 'id'>): Omit<MigrationProjectType, 'id'> {
  const name = (input.name ?? '').trim();
  const sourcePath = resolve((input.sourcePath ?? '').trim());
  const targetPath = resolve((input.targetPath ?? '').trim());

  if (!name) throw new Error('Укажите название миграции');
  if (!(input.sourcePath ?? '').trim() || !isDirectory(sourcePath)) throw new Error(`Текущий репозиторий не найден: ${input.sourcePath || '(путь не указан)'}`);
  if (!(input.targetPath ?? '').trim() || !isDirectory(targetPath)) throw new Error(`Целевой репозиторий не найден: ${input.targetPath || '(путь не указан)'}`);
  if (sourcePath === targetPath) throw new Error('Текущий и целевой репозитории — одна и та же папка');
  if (!existsSync(join(targetPath, '.git'))) {
    throw new Error(`Целевой репозиторий ${targetPath} — не git-репозиторий (нет .git): ветку задачи и результат некуда положить`);
  }
  if (targetPath.startsWith(`${sourcePath}/`) || targetPath.startsWith(`${sourcePath}\\`) || sourcePath.startsWith(`${targetPath}/`) || sourcePath.startsWith(`${targetPath}\\`)) {
    throw new Error('Один репозиторий лежит внутри другого — укажите две отдельные папки');
  }

  return {
    name,
    sourcePath,
    sourceInclude: cleanList(input.sourceInclude),
    sourceExclude: cleanList(input.sourceExclude),
    targetPath,
    targetBaseBranch: input.targetBaseBranch?.trim() || undefined,
    targetInclude: cleanList(input.targetInclude),
    targetExclude: cleanList(input.targetExclude),
  };
}

export function createMigration(input: Omit<MigrationProjectType, 'id'>): MigrationProjectType {
  return addMigration(validateMigration(input));
}

export interface MigrationParcelFiles {
  files: { relPath: string; content: string }[];
  sourceFiles: number;
  targetFiles: number;
}

// Both repositories as one parcel: source/<path> and target/<path>, anonymized like any other. The current repository must have files
// (it is what is being moved); the target may be empty — a project that moves into a brand-new repository.
export async function collectMigrationFiles(migration: MigrationProjectType, dictionary: Parameters<typeof applyDictionary>[1]): Promise<MigrationParcelFiles> {
  const read = (root: string, prefix: string, relPaths: string[]) =>
    relPaths.map((relPath) => ({
      relPath: `${prefix}${relPath}`,
      content: applyDictionary(readFileSync(join(root, relPath), 'utf-8'), dictionary, 'toRemote'),
    }));

  const sourceRel = await walkProjectFiles({ path: migration.sourcePath, include: migration.sourceInclude, exclude: migration.sourceExclude });

  if (sourceRel.length === 0) {
    throw new Error(
      `В текущем репозитории ${migration.sourcePath} нет файлов, подходящих под include/exclude, — переносить нечего. ` +
        'Проверьте путь и шаблоны include/exclude миграции в Settings.',
    );
  }

  const targetRel = await walkProjectFiles({ path: migration.targetPath, include: migration.targetInclude, exclude: migration.targetExclude });

  return {
    files: [...read(migration.sourcePath, SOURCE_PREFIX, sourceRel), ...read(migration.targetPath, TARGET_PREFIX, targetRel)],
    sourceFiles: sourceRel.length,
    targetFiles: targetRel.length,
  };
}

// Counts only — what the review shows before anything is read into a parcel.
export async function countMigrationFiles(migration: MigrationProjectType): Promise<{ sourceFiles: number; targetFiles: number }> {
  const [source, target] = await Promise.all([
    walkProjectFiles({ path: migration.sourcePath, include: migration.sourceInclude, exclude: migration.sourceExclude }),
    walkProjectFiles({ path: migration.targetPath, include: migration.targetInclude, exclude: migration.targetExclude }),
  ]);

  return { sourceFiles: source.length, targetFiles: target.length };
}

// A short name for the list when the person gave none: the first line of the task, cut.
export function migrationTitle(description: string, given?: string): string {
  const name = (given ?? '').trim();

  if (name) return name;

  const firstLine = description.trim().split('\n')[0]?.trim() ?? '';

  return `Миграция: ${firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine || 'без названия'}`;
}

// What Pull takes from a result parcel of a migration: only target/…, with that prefix cut. The current repository is never written.
export function targetFilesOf<T extends { relPath: string }>(files: T[]): T[] {
  return files.filter((file) => file.relPath.startsWith(TARGET_PREFIX)).map((file) => ({ ...file, relPath: file.relPath.slice(TARGET_PREFIX.length) }));
}
