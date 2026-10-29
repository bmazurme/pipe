import { lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

// Resolves an untrusted relative path (a parcel entry name, a model tool
// argument) against root, refusing absolute paths and anything that escapes
// root via `..`. A name that merely starts with dots (`..foo`) is legitimate.
// Anything under a `.git` directory is refused too: callers commit right
// after writing, so a parcel entry like `.git/config` (core.fsmonitor,
// core.hooksPath) or `.git/hooks/pre-commit` would run code chosen by
// whoever produced the parcel. Compared case-insensitively, on both
// separators, ignoring trailing dots/spaces — case-insensitive and Windows
// filesystems resolve `.GIT` or `.git.` to the same directory.
export function resolveInDir(root: string, relPath: string): string {
  if (isAbsolute(relPath)) {
    throw new Error(`Absolute path not allowed: ${relPath}`);
  }

  if (relPath.split(/[\\/]/).some((segment) => segment.replace(/[. ]+$/, '').toLowerCase() === '.git')) {
    throw new Error(`Path inside .git is not allowed: ${relPath}`);
  }

  const destination = resolve(root, relPath);
  const rel = relative(root, destination);

  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path escapes the working directory: ${relPath}`);
  }

  return destination;
}

// Walks every existing component from root down to destination and refuses
// the first symbolic link: resolveInDir is a pure path check, so a directory
// symlink already in the tree (`docs -> ../shared`) would otherwise let a
// write land outside root. Stops at the first component that does not exist.
export function assertNoSymlinkOnPath(root: string, destination: string): void {
  const rel = relative(root, destination);
  let current = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Path goes through a symlink: ${relative(root, current)}`);
    }
  }
}
