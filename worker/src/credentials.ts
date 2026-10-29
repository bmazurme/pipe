import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { writeJsonFileSync } from '@pipe/protocol/atomicWrite';

// What a worker keeps after it has been enrolled: its own key. Lives only in the state directory (a volume), mode
// 0600 — never in the environment, which is the point of enrolling instead of configuring a key by hand.
export interface StoredCredentials {
  bridgeApiUrl: string;
  workerId: number;
  name: string;
  key: string;
  enrolledAt: string;
}

export function credentialsPath(stateDir: string): string {
  return path.join(stateDir, 'credentials.json');
}

// The stored credentials, or null when there are none, they are unreadable, or they belong to another bridge (a worker
// moved to a different server must enrol again rather than present a key to the wrong place).
export function loadCredentials(stateDir: string, bridgeApiUrl: string): StoredCredentials | null {
  const file = credentialsPath(stateDir);

  if (!existsSync(file)) return null;

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<StoredCredentials>;

    if (
      typeof parsed.key !== 'string' ||
      !parsed.key.startsWith('brw_') ||
      typeof parsed.name !== 'string' ||
      typeof parsed.workerId !== 'number' ||
      parsed.bridgeApiUrl !== bridgeApiUrl
    ) {
      return null;
    }

    return {
      bridgeApiUrl: parsed.bridgeApiUrl,
      workerId: parsed.workerId,
      name: parsed.name,
      key: parsed.key,
      enrolledAt: typeof parsed.enrolledAt === 'string' ? parsed.enrolledAt : '',
    };
  } catch {
    return null;
  }
}

// Written atomically (temporary file + rename), so a crash never leaves half a key behind.
export function saveCredentials(stateDir: string, credentials: StoredCredentials): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeJsonFileSync(credentialsPath(stateDir), credentials, { mode: 0o600 });
}

export function clearCredentials(stateDir: string): void {
  rmSync(credentialsPath(stateDir), { force: true });
}
