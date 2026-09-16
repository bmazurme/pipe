import fg from 'fast-glob';

export async function walkProjectFiles(cwd: string, include: string[], exclude: string[]): Promise<string[]> {
  return fg(include, {
    cwd,
    ignore: exclude,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
}
