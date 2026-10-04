import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { parseState, syncStateSchema } from '@pipe/protocol/state';

import { STATE_PATH } from './paths.js';
import type { SyncState } from './types.js';

export function loadState(): SyncState {
  if (!existsSync(STATE_PATH)) {
    return {};
  }

  const result = parseState(syncStateSchema, JSON.parse(readFileSync(STATE_PATH, 'utf-8')));
  if ('error' in result) {
    throw new Error(`${STATE_PATH} is malformed: ${result.error}`);
  }
  return result.value;
}

export function saveState(state: SyncState): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

export function getLastHash(projectName: string): string | undefined {
  return loadState()[projectName]?.lastHash;
}

export function setLastHash(projectName: string, hash: string): void {
  const state = loadState();
  state[projectName] = { lastHash: hash };
  saveState(state);
}
