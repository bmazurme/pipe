import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Credentials } from './types.js';

const SECRET_FIELDS = ['refreshToken', 'gitlabToken', 'apiKey'] as const;

// Exact substring match (no heuristics) of sync-cli's own stored secrets over
// the given files; returns the relative paths that contain any of them.
// Never returns or logs the matched values. Empty/missing fields never match.
export function findOwnCredentials(
  dir: string,
  relPaths: string[],
  credentials: Partial<Credentials>,
): string[] {
  const needles = SECRET_FIELDS.map((field) => credentials[field])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => Buffer.from(value, 'utf-8'));

  if (needles.length === 0) return [];

  const hits: string[] = [];
  for (const relPath of relPaths) {
    const content = readFileSync(path.join(dir, relPath));
    if (needles.some((needle) => content.includes(needle))) hits.push(relPath);
  }

  return hits;
}
