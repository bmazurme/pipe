import { accessSync, constants } from 'node:fs';
import path from 'node:path';

// Claude Code's Bash tool needs bash or zsh on PATH. The worker image once shipped on plain
// node:alpine (busybox sh only): every Improve job then reported "No suitable shell found",
// could run no linter or test, and opened pull requests with unformatted code and tests it had
// broken. Checking up front turns that environment gap into a clear failed job instead of a
// green-looking one.
const SHELLS = ['bash', 'zsh'];

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findShell(
  pathEnv: string = process.env.PATH ?? '',
  executable: (file: string) => boolean = isExecutable,
): string | null {
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const shell of SHELLS) {
      const candidate = path.join(dir, shell);

      if (executable(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export function requireShell(
  pathEnv?: string,
  executable?: (file: string) => boolean,
): string {
  const shell = findShell(pathEnv, executable);

  if (!shell) {
    throw new Error(
      'No bash or zsh on PATH: Claude Code cannot run shell commands here, so it could not run the linter or the tests ' +
        'and its result would reach CI unchecked. Use a worker image that includes bash (worker/Dockerfile installs it).',
    );
  }

  return shell;
}
