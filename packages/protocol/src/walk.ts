import fg from 'fast-glob';

/**
 * Lists project files (relative to `cwd`) matching `include` minus `exclude`.
 *
 * Note: dotfiles and dot-directories (`.env.example`, `.gitlab-ci.yml`,
 * `.eslintrc`, `.github/**`, ...) are not matched by wildcards such as `**\/*`
 * (`dot: false`), but an include pattern that names the dot segment explicitly
 * (`.env.example`, `.github/**`) does return them — so list them in `include`
 * only on purpose. Symlinks are skipped (`followSymbolicLinks: false`,
 * `onlyFiles: true`).
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
