import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resolveInDir } from '@pipe/protocol/resolveInDir';

// Parcel entry names are untrusted. Every destination is resolved (and
// rejected if it escapes root) before the first write, so a bad parcel is not
// half-applied.
export function writeParcelFiles(
  root: string,
  files: Array<{ relPath: string; content: string }>,
  transform: (content: string) => string = (content) => content,
): void {
  const destinations = files.map((file) => resolveInDir(root, file.relPath));
  files.forEach((file, i) => {
    mkdirSync(path.dirname(destinations[i]), { recursive: true });
    writeFileSync(destinations[i], transform(file.content), 'utf-8');
  });
}
