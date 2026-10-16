import fg from 'fast-glob';

// What a tracked project packs when its own config says nothing. One list for every consumer (sync, reports): two copies
// had already drifted apart on what an empty array means.
export const DEFAULT_INCLUDE: readonly string[] = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.vue', '**/*.json'];
export const DEFAULT_EXCLUDE: readonly string[] = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/uploads/**',
];

/**
 * The globs a project is walked with: its own, or the defaults when it has none. A missing **and an empty** array both
 * fall back — an empty `exclude` must not mean "exclude nothing" (that packs `node_modules` and `.git` into a parcel)
 * and an empty `include` must not mean "walk nothing". Returns fresh arrays, safe to modify.
 */
export function resolveProjectGlobs(project: { include?: string[] | null; exclude?: string[] | null }): {
  include: string[];
  exclude: string[];
} {
  return {
    include: project.include?.length ? [...project.include] : [...DEFAULT_INCLUDE],
    exclude: project.exclude?.length ? [...project.exclude] : [...DEFAULT_EXCLUDE],
  };
}

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
