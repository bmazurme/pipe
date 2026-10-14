import { readFileSync } from 'node:fs';

// The version this build reports when it enrols (informational, shown on the Worker page). `manifest` is the package.json
// next to dist/; anything unreadable is "unknown" — a worker must never fail to start over a label.
export function workerVersion(manifest: URL = new URL('../package.json', import.meta.url)): string {
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf-8')) as { version?: unknown };

    return typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
