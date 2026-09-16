import fg from 'fast-glob';

export async function walkProjectFiles(
  projectPath: string,
  include: string[],
  exclude: string[],
): Promise<string[]> {
  return fg(include, {
    cwd: projectPath,
    ignore: exclude,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
}
