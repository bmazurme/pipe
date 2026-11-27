// R2 — updating the workers by itself. The button «Обновить worker» (#1259) makes a decision the board's agent carries out (pull `stable`, recreate the
// container, keep the old one until the new one stays up, roll back otherwise). This decides, when the owner has switched it on, WHEN bridge makes that
// decision instead of the owner: only in the window they chose, one board at a time, never under a running job, never again for a release that already
// failed on that board. Pure; WorkerAutoUpdateService supplies the facts and does the asking.
import type { BoardWorker } from './entities/board-report.entity';
import { isQuietNow, parseQuietHours } from '../telegram/quiet-hours';

export const DEFAULT_WINDOW = '03:00-05:00';
export const DEFAULT_TIMEZONE = 'Europe/Moscow';
// After an update (applied or failed) nothing else is started for this long: the next board waits for the first to prove itself.
export const SETTLE_MS = 20 * 60_000;
// A failed release is not tried again on that board for this long (a newer release, or the owner's button, is).
export const FAILED_RETRY_MS = 7 * 24 * 60 * 60_000;

// «03:00-05:00» → whether `now` is inside it, in the timezone. A window that cannot be read is NEVER «open»: a mistake must not turn into an update at noon.
export function inWindow(window: string, timezone: string, now: Date): boolean {
  try {
    const parsed = parseQuietHours(window);

    return parsed !== null && isQuietNow(parsed, timezone, now);
  } catch {
    return false;
  }
}

export function validateWindow(window: string): string | null {
  try {
    return parseQuietHours(window.trim().toLowerCase()) === null
      ? 'Окно не может быть выключено — выключите автообновление'
      : null;
  } catch (error) {
    return error instanceof Error
      ? error.message.replace('NOTIFY_QUIET_HOURS', 'Окно')
      : 'Окно не разобрано';
  }
}

// The worker containers of a board that run something other than the release `stable` is now. A container that did not say which release it
// runs (an agent older than version 6, an image not pulled from the registry) is NOT behind: «I do not know» never starts an update.
export function workersBehind(
  workers: BoardWorker[],
  latest: string | undefined,
): BoardWorker[] {
  if (!latest) return [];

  return workers.filter(
    (worker) => worker.digest !== undefined && worker.digest !== latest,
  );
}

// The name the worker has in bridge: the container `pipe-worker-pi-red` is the worker `pi-red`.
export const workerNameOf = (container: string): string =>
  container.replace(/^pipe-worker-/, '');

export interface BoardFacts {
  host: string;
  reportedAt: Date;
  workers: BoardWorker[];
  latest: string | undefined;
  /** Whether a worker decision for this board is waiting for the agent. */
  pending: boolean;
  /** The newest worker decision of this board, if any: how it ended, when, and for which release. */
  last: {
    status: string;
    finishedAt: Date | null;
    targetDigest: string | null;
  } | null;
  /** Jobs running or claimed on this board's workers right now. */
  busyJobs: number;
  /** Is the board's last report fresh enough to act on. */
  fresh: boolean;
}

export type Verdict =
  { update: true; digest: string } | { update: false; why: string };

// Whether to update THIS board now. `anyOtherBusy`: another board has an update waiting, or finished one less than SETTLE_MS ago.
export function decide(
  board: BoardFacts,
  ctx: { now: Date; anyOtherBusy: boolean },
): Verdict {
  const behind = workersBehind(board.workers, board.latest);

  if (behind.length === 0) return { update: false, why: 'up to date' };
  if (!board.fresh)
    return { update: false, why: 'the board has not reported lately' };
  if (board.pending)
    return { update: false, why: 'a decision is already waiting' };
  if (ctx.anyOtherBusy)
    return {
      update: false,
      why: 'another board is being updated or has just been',
    };

  // The report must be NEWER than the last update: an hourly report that predates it still says «behind».
  if (
    board.last?.finishedAt &&
    board.reportedAt.getTime() <= board.last.finishedAt.getTime()
  ) {
    return { update: false, why: 'the report is older than the last update' };
  }

  if (
    board.last?.finishedAt &&
    ctx.now.getTime() - board.last.finishedAt.getTime() < SETTLE_MS
  ) {
    return { update: false, why: 'the last update was just now' };
  }

  // The same release already failed on this board: not again by itself.
  if (
    board.last?.status === 'failed' &&
    board.last.targetDigest === board.latest &&
    board.last.finishedAt !== null &&
    ctx.now.getTime() - board.last.finishedAt.getTime() < FAILED_RETRY_MS
  ) {
    return { update: false, why: 'this release already failed here' };
  }

  if (board.busyJobs > 0)
    return {
      update: false,
      why: `${board.busyJobs} job(s) running on its workers`,
    };

  return { update: true, digest: board.latest as string };
}
