import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// A small extracted parcel, not a whole git project — a plain synchronous
// recursive listing is all worker needs (no glob/include-exclude config,
// unlike @pipe/protocol's own async, fast-glob-based walkProjectFiles).
export function listFilesRecursively(dir: string, cwd: string = dir): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...listFilesRecursively(full, cwd));
    } else if (entry.isFile()) {
      results.push(relative(cwd, full));
    }
  }

  return results;
}
