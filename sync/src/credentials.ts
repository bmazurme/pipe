import { readFileSync, existsSync } from 'node:fs';

import { writeJsonFileSync } from '@pipe/protocol';

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
  saveCredentials({ refreshToken: current.refreshToken ?? '', gitlabToken, apiKey: current.apiKey });
}

export function saveApiKey(apiKey: string): void {
  const current = loadCredentialsOrEmpty();
  saveCredentials({ refreshToken: current.refreshToken ?? '', gitlabToken: current.gitlabToken, apiKey });
}

export function saveCredentials(credentials: Credentials): void {
  // Owner-only, and atomic (IMPROVEMENTS_TECH.md 2.6) — writeJsonFileSync
  // applies the mode to the temp file at creation (never briefly
  // world-readable) and chmods the final path too, defensively.
  writeJsonFileSync(CREDENTIALS_PATH, credentials, { mode: 0o600 });
}
