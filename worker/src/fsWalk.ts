import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Tool-state directories that never belong in a result parcel (or in what a
// model is shown): a build/test run can leave 10^5+ files in node_modules.
export const EXCLUDED_RESULT_DIRS: ReadonlySet<string> = new Set(['.claude', 'node_modules']);

// A small extracted parcel, not a whole git project — a plain synchronous
// recursive listing is all worker needs (no glob/include-exclude config,
// unlike @pipe/protocol's own async, fast-glob-based walkProjectFiles).
// Directories named in skipDirs are never descended into.
export function listFilesRecursively(
  dir: string,
  cwd: string = dir,
  skipDirs?: ReadonlySet<string>,
): string[] {
  const results: string[] = [];
  const stack: string[] = [dir];

  while (stack.length > 0) {
    const current = stack.pop() as string;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);

      if (entry.isDirectory()) {
        if (!skipDirs?.has(entry.name)) stack.push(full);
      } else if (entry.isFile()) {
        results.push(relative(cwd, full));
      }
    }
  }

  return results;
}
