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

// A glob typed or pasted into a settings field with its quotes ("**/*.js", as copied from a JSON array or a shell line) would
// match nothing: the quote characters are part of the pattern. Trim, and drop one pair of matching quotes around it.
function cleanGlobs(patterns: string[] | null | undefined): string[] {
  return (patterns ?? [])
    .map((pattern) => pattern.trim().replace(/^(["'])(.*)\1$/, '$2').trim())
    .filter((pattern) => pattern.length > 0);
}

/**
 * The globs a project is walked with: its own, or the defaults when it has none. A missing **and an empty** array both
 * fall back — an empty `exclude` must not mean "exclude nothing" (that packs `node_modules` and `.git` into a parcel)
 * and an empty `include` must not mean "walk nothing". Patterns are cleaned of surrounding whitespace and quotes first.
 * Returns fresh arrays, safe to modify.
 */
export function resolveProjectGlobs(project: { include?: string[] | null; exclude?: string[] | null }): {
  include: string[];
  exclude: string[];
} {
  const include = cleanGlobs(project.include);
  const exclude = cleanGlobs(project.exclude);

  return {
    include: include.length ? include : [...DEFAULT_INCLUDE],
    exclude: exclude.length ? exclude : [...DEFAULT_EXCLUDE],
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
