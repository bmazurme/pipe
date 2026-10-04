import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { gitlabWorkerStateSchema, parseState, type GitlabWorkerState } from '@pipe/protocol/state';

import { GITLAB_WORKER_STATE_PATH } from './paths.js';

// Which GitLab issues gitlab-worker has already turned into a pushed parcel
// — once sent, never re-sent automatically, matching sync's ROADMAP.md
// ("иначе при каждом запуске будут пересоздаваться посылки на одни и те же
// issue"). Keyed the same way as sync's own agent-runner state and reports'
// subscription state: "projectId:iid". Re-exported from
// @pipe/protocol/state (IMPROVEMENTS_HARNESS.md 6.1) — see sync/src/types.ts's
// SyncState for why.
export type { GitlabWorkerState };

export const issueKey = (projectId: number | string, iid: number | string): string => `${projectId}:${iid}`;

export function loadGitlabWorkerState(): GitlabWorkerState {
  if (!existsSync(GITLAB_WORKER_STATE_PATH)) {
    return {};
  }

  const result = parseState(gitlabWorkerStateSchema, JSON.parse(readFileSync(GITLAB_WORKER_STATE_PATH, 'utf-8')));
  if ('error' in result) {
    throw new Error(`${GITLAB_WORKER_STATE_PATH} is malformed: ${result.error}`);
  }
  return result.value;
}

export function recordPushed(key: string, filename: string): void {
  const state = loadGitlabWorkerState();
  state[key] = { pushedAt: new Date().toISOString(), filename };
  writeFileSync(GITLAB_WORKER_STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}
