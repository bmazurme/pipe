import { resolveProjectGlobs, walkProjectFiles as walkProjectFilesGeneric } from '@pipe/protocol';

// A tracked project, or one side of a migration: a folder and the globs that pick its files (the defaults when it has none).
export interface WalkedTree {
  path: string;
  include?: string[];
  exclude?: string[];
}

export async function walkProjectFiles(project: WalkedTree): Promise<string[]> {
  const { include, exclude } = resolveProjectGlobs(project);

  return walkProjectFilesGeneric(project.path, include, exclude);
}
