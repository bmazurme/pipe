import fg from 'fast-glob';

/**
 * Lists project files (relative to `cwd`) matching `include` minus `exclude`.
 *
 * Note: dotfiles and dot-directories (`.env.example`, `.gitlab-ci.yml`,
 * `.eslintrc`, `.github/**`, ...) are never returned (`dot: false`), even if an
 * include pattern names them, and symlinks are skipped (`followSymbolicLinks:
 * false`, `onlyFiles: true`). They are therefore never part of a project parcel.
 */
export async function walkProjectFiles(cwd: string, include: string[], exclude: string[]): Promise<string[]> {
  return fg(include, {
    cwd,
    ignore: exclude,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
}
