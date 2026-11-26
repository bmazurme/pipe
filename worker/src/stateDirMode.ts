import { chmodSync, existsSync, statSync } from 'node:fs';

// With WORKER_RUN_AS the job code runs as another OS user that must not get into the worker's state directory (its key, its VPN config). The
// image makes the directory 0700, but a volume created by an older image keeps whatever mode it had (0755: the runner can list the files, and
// is stopped only by each file's own 0600). Tighten it at start so isolation never depends on how old the volume is. Best effort: returns what
// it did, never throws.
export function restrictStateDir(dir: string): 'tightened' | 'already' | 'missing' | 'failed' {
  try {
    if (!existsSync(dir)) return 'missing';

    if ((statSync(dir).mode & 0o077) === 0) return 'already';

    chmodSync(dir, 0o700);

    return 'tightened';
  } catch {
    return 'failed';
  }
}
