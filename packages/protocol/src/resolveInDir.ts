import { isAbsolute, relative, resolve, sep } from 'node:path';

// Resolves an untrusted relative path (a parcel entry name, a model tool
// argument) against root, refusing absolute paths and anything that escapes
// root via `..`. A name that merely starts with dots (`..foo`) is legitimate.
export function resolveInDir(root: string, relPath: string): string {
  if (isAbsolute(relPath)) {
    throw new Error(`Absolute path not allowed: ${relPath}`);
  }

  const destination = resolve(root, relPath);
  const rel = relative(root, destination);

  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path escapes the working directory: ${relPath}`);
  }

  return destination;
}
