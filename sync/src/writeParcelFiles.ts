import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { assertNoSymlinkOnPath, resolveInDir } from '@pipe/protocol/resolveInDir';

// Parcel entry names are untrusted. Every destination is resolved (and
// rejected if it escapes root or goes through an existing symlink) before the first write, so a bad parcel is not
// half-applied.
export function writeParcelFiles(
  root: string,
  files: Array<{ relPath: string; content: string }>,
  transform: (content: string) => string = (content) => content,
): void {
  const destinations = files.map((file) => resolveInDir(root, file.relPath));
  for (const destination of destinations) assertNoSymlinkOnPath(root, destination);
  files.forEach((file, i) => {
    mkdirSync(path.dirname(destinations[i]), { recursive: true });
    writeFileSync(destinations[i], transform(file.content), 'utf-8');
  });
}
