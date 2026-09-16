#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SYNC_STATE_PATH = path.join(REPO_ROOT, 'sync', '.sync-state.json');
const SYNC_AGENT_STATE_PATH = path.join(REPO_ROOT, 'sync', '.sync-agent-state.json');
const REPORTS_STATE_PATH = path.join(
  REPO_ROOT,
  'reports',
  'packages',
  'server',
  'src',
  'subscription',
  'subscription-state.json',
);

interface SyncState {
  [projectName: string]: { lastHash: string };
}

interface SyncAgentState {
  [issueKey: string]: {
    lastOwnOutputHash?: string;
    pending?: {
      issueTitle: string;
      branch: string;
      worktreeDir: string;
    };
  };
}

interface SubscriptionState {
  [issueKey: string]: {
    step: string;
    branch?: string;
    parcelId?: number;
    pushedAt?: string;
    pulledAt?: string;
    publishedAt?: string;
  };
}

function readJson<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
}

function printProjectSyncState(state: SyncState | undefined): void {
  console.log('== sync: project push/pull state (.sync-state.json) ==');
  const entries = Object.entries(state ?? {});
  if (entries.length === 0) {
    console.log('  no state yet');
  } else {
    for (const [project, { lastHash }] of entries) {
      console.log(`  ${project}: lastHash ${lastHash.slice(0, 12)}…`);
    }
  }
  console.log();
}

function printTaskState(agentState: SyncAgentState | undefined, subscriptionState: SubscriptionState | undefined): void {
  console.log('== task status (sync agent-runner + reports subscription, by "projectId:iid") ==');

  const keys = new Set([...Object.keys(agentState ?? {}), ...Object.keys(subscriptionState ?? {})]);

  if (keys.size === 0) {
    console.log('  no in-flight tasks');
    console.log();
    return;
  }

  for (const key of [...keys].sort()) {
    console.log(`  ${key}:`);

    const agent = agentState?.[key];
    if (agent?.pending) {
      console.log(
        `    sync (agent-runner): pending — "${agent.pending.issueTitle}" on branch ${agent.pending.branch}`,
      );
    } else if (agent) {
      console.log(`    sync (agent-runner): last output hash ${agent.lastOwnOutputHash?.slice(0, 12) ?? '—'}…`);
    } else {
      console.log('    sync (agent-runner): no local state');
    }

    const subscription = subscriptionState?.[key];
    if (subscription) {
      const parts = [`step ${subscription.step}`];
      if (subscription.branch) parts.push(`branch ${subscription.branch}`);
      if (subscription.pushedAt) parts.push(`pushed ${subscription.pushedAt}`);
      if (subscription.pulledAt) parts.push(`pulled ${subscription.pulledAt}`);
      console.log(`    reports (subscription): ${parts.join(', ')}`);
    } else {
      console.log('    reports (subscription): no local state');
    }
  }

  console.log();
}

function main(): void {
  const syncState = readJson<SyncState>(SYNC_STATE_PATH);
  const syncAgentState = readJson<SyncAgentState>(SYNC_AGENT_STATE_PATH);
  const subscriptionState = readJson<SubscriptionState>(REPORTS_STATE_PATH);

  printProjectSyncState(syncState);
  printTaskState(syncAgentState, subscriptionState);

  console.log('== bridge ==');
  console.log('  no local task state (storage relay only — see bridge/README.md)');
}

main();
