import type { WorkerBridgeClient } from './bridgeClient.js';
import { logger } from './logger.js';

// Bridge treats a worker as down after 30s without a heartbeat, and the main
// loop doesn't poll (so doesn't claim) while a job runs — ping well inside that.
export const HEARTBEAT_INTERVAL_MS = 10_000;

// Runs `work` while pinging bridge every HEARTBEAT_INTERVAL_MS. A job pings from inside processJob, but a chat
// turn is one long model call: without this the worker looked "down" on the Worker page (and chat said it did
// not answer) for as long as a reply took. Best-effort like the job ping: a missed one never fails the work,
// and the timer is always cleared.
export async function withHeartbeat<T>(
  client: Pick<WorkerBridgeClient, 'heartbeat'>,
  workerName: string,
  work: () => Promise<T>,
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): Promise<T> {
  const timer = setInterval(() => {
    void (async () => client.heartbeat(workerName))().catch((error) => {
      logger.warn({ err: error }, 'failed to send heartbeat to bridge');
    });
  }, intervalMs);

  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}
