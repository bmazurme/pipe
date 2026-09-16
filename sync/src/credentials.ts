import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';

import { CREDENTIALS_PATH } from './paths.js';
import type { Credentials } from './types.js';

export function loadCredentials(): Credentials {
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      'Not logged in. Run "sync-cli login <refreshToken>" first ' +
        '(copy the bridgeRefreshToken cookie value after signing in to bridge in a browser).',
    );
  }

  return JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8')) as Credentials;
}

// Issue-mode only — unlike loadCredentials(), tolerates a missing/incomplete
// file so "login-gitlab" can be run before (or without) "login".
export function loadCredentialsOrEmpty(): Partial<Credentials> {
  if (!existsSync(CREDENTIALS_PATH)) {
    return {};
  }

  return JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8')) as Credentials;
}

export function saveGitlabToken(gitlabToken: string): void {
  const current = loadCredentialsOrEmpty();
  saveCredentials({ refreshToken: current.refreshToken ?? '', gitlabToken });
}

export function saveCredentials(credentials: Credentials): void {
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2) + '\n', {
    mode: 0o600,
  });
  // writeFileSync only applies `mode` when creating the file; make sure an
  // existing file (e.g. from a rotated refresh token) stays owner-only too.
  chmodSync(CREDENTIALS_PATH, 0o600);
}
