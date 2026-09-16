import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { GITLAB_WORKER_STATE_PATH } from './paths.js';

// Which GitLab issues gitlab-worker has already turned into a pushed parcel
// — once sent, never re-sent automatically, matching sync's docs/roadmap.md
// ("иначе при каждом запуске будут пересоздаваться посылки на одни и те же
// issue"). Keyed the same way as sync's own agent-runner state and reports'
// subscription state: "projectId:iid".
export interface GitlabWorkerState {
  [issueKey: string]: {
    pushedAt: string;
    filename: string;
  };
}

export const issueKey = (projectId: number | string, iid: number | string): string => `${projectId}:${iid}`;

export function loadGitlabWorkerState(): GitlabWorkerState {
  if (!existsSync(GITLAB_WORKER_STATE_PATH)) {
    return {};
  }
  return JSON.parse(readFileSync(GITLAB_WORKER_STATE_PATH, 'utf-8')) as GitlabWorkerState;
}

export function recordPushed(key: string, filename: string): void {
  const state = loadGitlabWorkerState();
  state[key] = { pushedAt: new Date().toISOString(), filename };
  writeFileSync(GITLAB_WORKER_STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}
