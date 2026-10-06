import { hostname } from 'os';
import { resolve, sep } from 'path';
import { fileURLToPath } from 'url';

import { getAllIssueStates } from './state-props';
import { listParcels, sendClientEvent, sendHeartbeat } from './bridge-client';
import { pullSubscriptionIssue } from './handler';
import { openPullRequestForTask } from './pull-request';
import { getSettings } from '../settings/props';
import { getSubscriptionConfig } from './config-props';

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
  // After a successful pull: open the PR for a GitHub task (no-op elsewhere).
  afterPull: (projectId: string, iid: string) => Promise<unknown>;
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
  afterPull: openPullRequestForTask,
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

          // The pull itself is done and recorded — a failed PR must not look
          // like a failed pull (nor be retried as one), so it is reported on
          // its own and the step stays `pulled`; Publish can open it later.
          await deps.afterPull(projectId, iid).catch(async (error) => {
            const message = error instanceof Error ? error.message : String(error);

            console.warn(`Autopilot: PR for ${key} failed:`, message);
            await deps.event(name, { type: 'pull_failed', taskKey: key, error: `PR не создан: ${message}`.slice(0, 300) }).catch(() => undefined);
          });
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

// A tracked repo that contains this very server is a trap under `--watch`: a
// pull that touches the server's sources restarts it mid-flight. Not an
// error (it is exactly what self-improvement of pipe means) — but the
// contour should run without --watch (`npm run start:once`) or from a
// separate checkout.
function warnIfTrackingOwnSources(): void {
  const own = fileURLToPath(new URL('..', import.meta.url));

  for (const project of getSubscriptionConfig().trackedProjects) {
    if (own.startsWith(resolve(project.path) + sep)) {
      console.warn(
        `Autopilot: tracked repo ${project.path} contains this server's own sources. ` +
          'Run reports without --watch (npm run start:once) or from a separate checkout, ' +
          'or a pull that changes server code will restart it mid-pull.',
      );
    }
  }
}

export function startAutopilot(): void {
  if (process.env.REPORTS_AUTOPILOT !== 'true') return;

  warnIfTrackingOwnSources();

  const autopilot = createAutopilot();

  console.log('Autopilot: on (heartbeat + auto-pull of ready results)');

  void autopilot.beat();
  setInterval(() => void autopilot.beat(), HEARTBEAT_EVERY_MS).unref();
  setInterval(() => void autopilot.pullReady(), PULL_EVERY_MS).unref();
}
