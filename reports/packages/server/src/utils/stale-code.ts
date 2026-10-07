import { readdirSync, statSync } from 'fs';
import { join } from 'path';

// This server is normally started without `--watch` (see start:once), so it keeps
// running whatever code it loaded at startup. Twice that has silently bitten the
// pipeline: the autopilot kept running a build from before the PR-opening code
// existed (so no PR was ever opened), and a build with an older hash order made
// the worker reject valid parcels. Nothing told anyone — this does.

export const STARTED_AT = Date.now();

// Only files that are actually loaded: TypeScript sources (not tests) and built
// JS. Runtime state (settings.json, subscription-state.json, props.json…) is
// rewritten under src/ all the time and must never count as a code change.
export function isCodeFile(name: string): boolean {
  return (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) || name.endsWith('.js');
}

// Newest mtime (ms) of any code file under the given directories; 0 when none
// exist. Missing directories are skipped — the protocol build may live elsewhere
// in a standalone deployment.
export function newestCodeChange(directories: string[]): number {
  let newest = 0;

  const walk = (directory: string): void => {
    let entries;

    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

      const full = join(directory, entry.name);

      if (entry.isDirectory()) walk(full);
      else if (isCodeFile(entry.name)) newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };

  directories.forEach(walk);

  return newest;
}

export interface CodeStatus {
  startedAt: string;
  newestChangeAt: string | null;
  // True when code on disk changed after this process started.
  stale: boolean;
}

export function codeStatus(directories: string[], startedAt = STARTED_AT): CodeStatus {
  const newest = newestCodeChange(directories);

  return {
    startedAt: new Date(startedAt).toISOString(),
    newestChangeAt: newest ? new Date(newest).toISOString() : null,
    stale: newest > startedAt,
  };
}
