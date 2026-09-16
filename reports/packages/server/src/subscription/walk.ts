import fg from 'fast-glob';
import type { TrackedProjectType } from '@reports/shared';

export const DEFAULT_INCLUDE = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.vue', '**/*.json'];
export const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/uploads/**'];

export async function walkProjectFiles(project: TrackedProjectType): Promise<string[]> {
  return fg(project.include?.length ? project.include : DEFAULT_INCLUDE, {
    cwd: project.path,
    ignore: project.exclude?.length ? project.exclude : DEFAULT_EXCLUDE,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
}
