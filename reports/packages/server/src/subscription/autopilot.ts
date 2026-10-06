import { hostname } from 'os';

import { getAllIssueStates } from './state-props';
import { listParcels, sendClientEvent, sendHeartbeat } from './bridge-client';
import { pullSubscriptionIssue } from './handler';
import { getSettings } from '../settings/props';

const HEARTBEAT_EVERY_MS = 15_000;
const PULL_EVERY_MS = 30_000;
// A pull that failed (dirty working tree, missing key, ...) won't fix itself
// in 30s; retrying that often would just spam the Telegram alert.
const RETRY_FAILED_AFTER_MS = 10 * 60_000;

export type AutopilotDeps = {
  hasBridge: () => boolean;
  heartbeat: (name: string) => Promise<void>;
  event: typeof sendClientEvent;
  pushedKeys: () => string[];
  resultReady: (taskKey: string) => Promise<boolean>;
  pull: (projectId: string, iid: string) => Promise<{ branch?: string }>;
  now: () => number;
};

const defaultDeps: AutopilotDeps = {
  hasBridge: () => {
    const { bridgeApiUrl, bridgeStorageApiKey } = getSettings();

    return Boolean(bridgeApiUrl && bridgeStorageApiKey);
  },
  heartbeat: sendHeartbeat,
  event: sendClientEvent,
  pushedKeys: () =>
    Object.entries(getAllIssueStates())
      .filter(([, state]) => state.step === 'pushed')
      .map(([key]) => key),
  resultReady: async (taskKey) => (await listParcels({ channel: 'issue', taskKey, direction: 'result' })).length > 0,
  pull: pullSubscriptionIssue,
  now: Date.now,
};

// The headless half of the Subscription flow, for a reports instance running
// unattended in the closed contour: it keeps bridge informed that it is alive
// and, whenever a result for a pushed task shows up on bridge, pulls it into
// the task branch exactly as the UI's Pull button would (de-anonymize, commit,
// push the branch — never the target branch). Opt-in via REPORTS_AUTOPILOT.
export function createAutopilot(deps: AutopilotDeps = defaultDeps, name = hostname()) {
  const failedAt = new Map<string, number>();
  let pulling = false;

  async function beat(): Promise<void> {
    if (!deps.hasBridge()) return;

    try {
      await deps.heartbeat(name);
    } catch (error) {
      console.warn('Autopilot heartbeat failed:', error instanceof Error ? error.message : error);
    }
  }

  // One pass over every pushed task. Sequential, and non-reentrant: a pull
  // touches the working tree of a tracked repo, so two at once would collide.
  async function pullReady(): Promise<void> {
    if (!deps.hasBridge() || pulling) return;

    pulling = true;

    try {
      for (const key of deps.pushedKeys()) {
        const lastFailure = failedAt.get(key);

        if (lastFailure !== undefined && deps.now() - lastFailure < RETRY_FAILED_AFTER_MS) continue;

        try {
          if (!(await deps.resultReady(key))) continue;

          const [projectId, iid] = key.split(':');
          const state = await deps.pull(projectId, iid);

          failedAt.delete(key);
          await deps.event(name, { type: 'pulled', taskKey: key, branch: state.branch }).catch(() => undefined);
        } catch (error) {
          failedAt.set(key, deps.now());

          const message = error instanceof Error ? error.message : String(error);

          console.warn(`Autopilot pull of ${key} failed:`, message);
          await deps.event(name, { type: 'pull_failed', taskKey: key, error: message.slice(0, 300) }).catch(() => undefined);
        }
      }
    } finally {
      pulling = false;
    }
  }

  return { beat, pullReady };
}

export function startAutopilot(): void {
  if (process.env.REPORTS_AUTOPILOT !== 'true') return;

  const autopilot = createAutopilot();

  console.log('Autopilot: on (heartbeat + auto-pull of ready results)');

  void autopilot.beat();
  setInterval(() => void autopilot.beat(), HEARTBEAT_EVERY_MS).unref();
  setInterval(() => void autopilot.pullReady(), PULL_EVERY_MS).unref();
}
