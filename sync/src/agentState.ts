import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { AGENT_STATE_PATH } from './paths.js';
import type { AgentRunnerState } from './types.js';

export const issueKey = (projectId: string, iid: string): string => `${projectId}:${iid}`;

export function loadAgentState(): AgentRunnerState {
  if (!existsSync(AGENT_STATE_PATH)) {
    return {};
  }
  return JSON.parse(readFileSync(AGENT_STATE_PATH, 'utf-8')) as AgentRunnerState;
}

export function recordOwnOutput(key: string, contentHash: string): void {
  const state = loadAgentState();
  state[key] = { lastOwnOutputHash: contentHash };
  writeFileSync(AGENT_STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}
