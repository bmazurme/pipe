import { writeFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

export interface WriteJsonFileOptions {
  // For a sensitive file (sync's credentials): applied to the temp file at
  // creation, not chmod'd on afterwards — the file's content must never be
  // briefly readable under looser permissions even for the short window
  // before rename(). rename() replacing an existing path inherits the
  // source file's own mode on POSIX, so this is already correct without a
  // separate chmodSync — but one is still applied to the final path
  // defensively, matching what the one caller that needs this already did
  // before this helper existed.
  mode?: number;
}

// IMPROVEMENTS_TECH.md 2.6 — every local state-file writer across
// sync/reports/harness (11 call sites, confirmed by grep before writing
// this) used a plain `writeFileSync(path, JSON.stringify(data))`. A
// process killed mid-write (a crash, kill -9, a bad deploy restart) leaves
// a truncated file behind — and every reader of these files already
// treats malformed JSON as a hard failure (the "errors as data, never
// silently trust a cast" convention @pipe/protocol/state's parseState()
// and friends already use), so a corrupted write is a real, not
// hypothetical, way to lose a state file. Writing to a temp file in the
// same directory and renaming over the real path avoids this: rename() is
// atomic on the same filesystem (a POSIX guarantee; Node's fs.rename
// handles the Windows equivalent — MoveFileEx with the replace-existing
// flag — the same way), so the real path always ends up holding either
// the old content or the complete new content, never something in
// between. The temp file has to be in the *same* directory as the real
// path — rename() across filesystems isn't atomic (and on Linux, isn't
// even guaranteed to work at all).
export function writeJsonFileSync(filePath: string, data: unknown, options: WriteJsonFileOptions = {}): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', options.mode !== undefined ? { mode: options.mode } : undefined);
  renameSync(tmpPath, filePath);

  if (options.mode !== undefined) {
    chmodSync(filePath, options.mode);
  }
}
