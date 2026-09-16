import type { TrackedProjectType } from '@reports/shared';
import { walkProjectFiles as walkProjectFilesGeneric } from '@pipe/protocol';

export const DEFAULT_INCLUDE = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.vue', '**/*.json'];
export const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/uploads/**'];

export async function walkProjectFiles(project: TrackedProjectType): Promise<string[]> {
  return walkProjectFilesGeneric(
    project.path,
    project.include?.length ? project.include : DEFAULT_INCLUDE,
    project.exclude?.length ? project.exclude : DEFAULT_EXCLUDE,
  );
}
