import type { TrackedProjectType } from '@reports/shared';
import { resolveProjectGlobs, walkProjectFiles as walkProjectFilesGeneric } from '@pipe/protocol';

export async function walkProjectFiles(project: TrackedProjectType): Promise<string[]> {
  const { include, exclude } = resolveProjectGlobs(project);

  return walkProjectFilesGeneric(project.path, include, exclude);
}
