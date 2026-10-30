import { readFileSync, existsSync } from 'node:fs';

import { writeJsonFileSync } from '@pipe/protocol';

import { CREDENTIALS_PATH } from './paths.js';
import type { Credentials } from './types.js';

function readCredentialsFile(filePath: string): Credentials {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Credentials;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Credentials file ${filePath} is not valid JSON — delete it and run sync-cli login again`);
    }
    throw err;
  }
}

export function loadCredentials(filePath: string = CREDENTIALS_PATH): Credentials {
  if (!existsSync(filePath)) {
    throw new Error(
      'Not logged in. Run "sync-cli login <refreshToken>" first ' +
        '(copy the bridgeRefreshToken cookie value after signing in to bridge in a browser).',
    );
  }

  return readCredentialsFile(filePath);
}

// Issue-mode only — unlike loadCredentials(), tolerates a missing/incomplete
// file so "login-gitlab" can be run before (or without) "login". A corrupt
// file is still an error, so a stored token is never silently dropped on save.
export function loadCredentialsOrEmpty(filePath: string = CREDENTIALS_PATH): Partial<Credentials> {
  if (!existsSync(filePath)) {
    return {};
  }

  return readCredentialsFile(filePath);
}

export function saveGitlabToken(gitlabToken: string, filePath: string = CREDENTIALS_PATH): void {
  const current = loadCredentialsOrEmpty(filePath);
  saveCredentials({ refreshToken: current.refreshToken ?? '', gitlabToken, apiKey: current.apiKey }, filePath);
}

export function saveApiKey(apiKey: string, filePath: string = CREDENTIALS_PATH): void {
  const current = loadCredentialsOrEmpty(filePath);
  saveCredentials({ refreshToken: current.refreshToken ?? '', gitlabToken: current.gitlabToken, apiKey }, filePath);
}

export function saveRefreshToken(refreshToken: string, filePath: string = CREDENTIALS_PATH): void {
  const current = loadCredentialsOrEmpty(filePath);
  saveCredentials({ ...current, refreshToken }, filePath);
}

export function saveCredentials(credentials: Credentials, filePath: string = CREDENTIALS_PATH): void {
  // Owner-only, and atomic (IMPROVEMENTS_TECH.md 2.6) — writeJsonFileSync
  // applies the mode to the temp file at creation (never briefly
  // world-readable) and chmods the final path too, defensively.
  writeJsonFileSync(filePath, credentials, { mode: 0o600 });
}
