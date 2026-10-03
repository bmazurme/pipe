import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { SubscriptionStateEntryType } from '@reports/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const statePath = join(__dirname, 'subscription-state.json');

type SubscriptionState = Record<string, SubscriptionStateEntryType>;

export const issueKey = (projectId: string | number, iid: string | number): string => `${projectId}:${iid}`;

const readState = (): SubscriptionState => {
  if (!existsSync(statePath)) {
    return {};
  }

  return JSON.parse(readFileSync(statePath, 'utf-8'));
};

const writeState = (state: SubscriptionState): SubscriptionState => {
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

  return state;
};

export const getAllIssueStates = (): SubscriptionState => readState();

export const getIssueState = (projectId: string | number, iid: string | number): SubscriptionStateEntryType | undefined => {
  return readState()[issueKey(projectId, iid)];
};

export const setIssueState = (
  projectId: string | number,
  iid: string | number,
  patch: Partial<SubscriptionStateEntryType>,
): SubscriptionStateEntryType => {
  const state = readState();
  const key = issueKey(projectId, iid);
  const existing = state[key];
  const next: SubscriptionStateEntryType = {
    ...existing,
    ...patch,
    step: patch.step ?? existing?.step ?? 'init',
  };

  state[key] = next;
  writeState(state);

  return next;
};

// For a GitLab-backed issue, this only resets local pipeline progress — the
// issue itself stays listed (handleListSubscriptionIssues sources that from
// GitLab, not from this file). For a manual issue, state is its only
// record anywhere, so this makes it disappear entirely.
export const removeIssueState = (projectId: string | number, iid: string | number): void => {
  const state = readState();
  delete state[issueKey(projectId, iid)];
  writeState(state);
};
