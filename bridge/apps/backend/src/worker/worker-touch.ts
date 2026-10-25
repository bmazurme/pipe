import { IsNull, LessThan, Or, Repository } from 'typeorm';
import { Worker } from './entities/worker.entity';

// How often a worker's lastSeenAt is rewritten at most. Well below the 30 s "online" threshold of
// WorkerHeartbeatService, so a polling worker stays up while one poll tick causes a single UPDATE.
export const TOUCH_EVERY_MS = 5_000;

export function isRecentlySeen(
  lastSeenAt: Date | null | undefined,
  now: number = Date.now(),
): boolean {
  return !!lastSeenAt && now - lastSeenAt.getTime() < TOUCH_EVERY_MS;
}

// Marks the worker as seen, writing only if the stored value is older than TOUCH_EVERY_MS.
// Pass the already loaded `lastSeenAt` to skip the query entirely when it is recent.
export async function touchWorker(
  repository: Repository<Worker>,
  workerId: number,
  loadedLastSeenAt?: Date | null,
): Promise<void> {
  const now = Date.now();

  if (isRecentlySeen(loadedLastSeenAt, now)) return;

  const cutoff = new Date(now - TOUCH_EVERY_MS);

  await repository.update(
    { id: workerId, lastSeenAt: Or(IsNull(), LessThan(cutoff)) },
    { lastSeenAt: new Date(now) },
  );
}
