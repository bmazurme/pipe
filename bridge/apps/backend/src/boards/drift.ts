// R1 — the watchdog for drift and silent failures. Pure: what a board's agent reported about its worker containers and the versions the
// workers announce are judged here, so the things that were found by accident (a worker running an old image, a container that restarts
// all night, an update that failed and nobody read the result) show up on their own. The service stores nothing; it asks, this decides.

import type { BoardWorker } from './entities/board-report.entity';

export type DriftLevel = 'bad' | 'warn';

export interface DriftItem {
  /** Stable between runs — what the daily digest compares to know whether anything changed. */
  id: string;
  level: DriftLevel;
  /** The board's host, or the worker's name. */
  subject: string;
  text: string;
}

export interface DriftBoard {
  host: string;
  reportedAt: Date;
  online: boolean;
  outdatedScripts: number;
  workers: BoardWorker[];
  /** Said by the agent (v5+) on boards that run workers; undefined = an agent that does not say, which is not a finding. */
  workerEgress?: boolean;
  /** R2: the worker containers that run a release other than the current `stable`. */
  imageBehind?: string[];
  /** A worker decision is waiting for the agent: the update is on its way, not a finding. */
  updatePending?: boolean;
  workerLast: {
    status: string;
    result: string | null;
    finishedAt: Date | null;
  } | null;
  lastUpdate: {
    status: string;
    result: string | null;
    finishedAt: Date | null;
  } | null;
}

export interface DriftWorker {
  name: string;
  version: string | null;
  online: boolean;
  enabled: boolean;
}

export interface DriftView {
  status: 'ok' | 'warn' | 'bad';
  items: DriftItem[];
}

// Docker restarts a container that exits; a handful over its life is a bad day, many is a loop. The counter starts again when the
// container is recreated (an update), so it is "since the last update".
export const RESTARTS_WARN = 3;
export const RESTARTS_BAD = 10;
// A container this young that has restarted is still going round the loop right now.
export const FRESH_RESTART_MS = 10 * 60_000;
// A failed decision is worth saying for a day; after that it is history, and the next success or failure replaces it.
export const FAILED_UPDATE_SHOWN_MS = 24 * 60 * 60_000;
// The image the project publishes for the Pi workers (see infra/bridge-pi/deploy-worker.sh).
export const STABLE_TAG = ':stable';

const hours = (ms: number) => Math.max(1, Math.round(ms / 3_600_000));

// "0.1.10" > "0.1.9": numeric parts, so a plain string comparison would get it wrong. Anything that is not x.y.z is not compared.
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());

    return match
      ? [Number(match[1]), Number(match[2]), Number(match[3])]
      : null;
  };
  const left = parse(a);
  const right = parse(b);

  if (!left || !right) return null;

  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }

  return 0;
}

function boardItems(board: DriftBoard, now: Date): DriftItem[] {
  const items: DriftItem[] = [];
  const add = (id: string, level: DriftLevel, text: string) =>
    items.push({ id: `${board.host}:${id}`, level, subject: board.host, text });

  if (!board.online) {
    add(
      'offline',
      'bad',
      `плата не выходила на связь ${hours(now.getTime() - board.reportedAt.getTime())} ч`,
    );
  }

  if (board.outdatedScripts > 0) {
    add(
      'scripts',
      'warn',
      `скрипты на плате отстают от main (${board.outdatedScripts})`,
    );
  }

  if (board.workers.length > 0 && board.workerEgress === false) {
    add(
      'worker-egress',
      'warn',
      'фильтр домашней сети для воркеров не включён — контейнер может ходить в LAN и на саму плату (S1, infra/worker-egress)',
    );
  }

  if ((board.imageBehind?.length ?? 0) > 0 && !board.updatePending) {
    add(
      'worker-behind',
      'warn',
      `воркер на образе не последнего релиза (${(board.imageBehind as string[]).map((name) => name.replace(/^pipe-worker-/, '')).join(', ')}) — «Обновить worker» на странице «Платы» или включите автообновление`,
    );
  }

  for (const worker of board.workers) {
    const label = worker.name.replace(/^pipe-worker-/, '');

    if (!worker.running) {
      add(
        `worker-down:${worker.name}`,
        'bad',
        `${label}: контейнер воркера не запущен`,
      );
    }

    if (worker.oomKilled) {
      add(
        `worker-oom:${worker.name}`,
        'warn',
        `${label}: контейнер убит из-за нехватки памяти`,
      );
    }

    const restarts = worker.restartCount ?? 0;

    if (restarts >= RESTARTS_WARN) {
      const startedMs = worker.startedAt ? Date.parse(worker.startedAt) : NaN;
      const looping =
        worker.running &&
        Number.isFinite(startedMs) &&
        now.getTime() - startedMs < FRESH_RESTART_MS;

      add(
        `worker-restarts:${worker.name}`,
        restarts >= RESTARTS_BAD || looping ? 'bad' : 'warn',
        `${label}: контейнер перезапускался ${restarts} раз(а)${looping ? ', и это происходит сейчас' : ''}`,
      );
    }

    if (!worker.image.endsWith(STABLE_TAG)) {
      add(
        `worker-image:${worker.name}`,
        'warn',
        `${label}: образ «${worker.image}», а не ${STABLE_TAG.slice(1)} — не обновится кнопкой`,
      );
    }
  }

  const failedRecently = (
    last: {
      status: string;
      result: string | null;
      finishedAt: Date | null;
    } | null,
  ) =>
    last !== null &&
    last.status === 'failed' &&
    (last.finishedAt === null ||
      now.getTime() - last.finishedAt.getTime() < FAILED_UPDATE_SHOWN_MS);

  if (board.workerLast && failedRecently(board.workerLast)) {
    add(
      'worker-update-failed',
      'warn',
      `обновление worker не удалось${board.workerLast.result ? `: ${board.workerLast.result.slice(0, 120)}` : ''}`,
    );
  }

  if (board.lastUpdate && failedRecently(board.lastUpdate)) {
    add(
      'scripts-update-failed',
      'warn',
      `обновление скриптов не удалось${board.lastUpdate.result ? `: ${board.lastUpdate.result.slice(0, 120)}` : ''}`,
    );
  }

  return items;
}

// A worker that announces an older version than another one of the fleet is running an old image — whatever the board says about its tag.
function versionItems(workers: DriftWorker[]): DriftItem[] {
  const live = workers.filter((w) => w.enabled && w.online && w.version);
  let newest: string | null = null;

  for (const worker of live) {
    if (
      newest === null ||
      (compareVersions(worker.version as string, newest) ?? 0) > 0
    ) {
      newest = worker.version;
    }
  }

  if (newest === null) return [];

  return live
    .filter(
      (w) => (compareVersions(w.version as string, newest as string) ?? 0) < 0,
    )
    .map((w) => ({
      id: `worker-version:${w.name}`,
      level: 'warn' as const,
      subject: w.name,
      text: `воркер ${w.name} на версии ${w.version}, в парке уже ${newest}`,
    }));
}

export function assessDrift(
  boards: DriftBoard[],
  workers: DriftWorker[],
  now: Date = new Date(),
): DriftView {
  const items = [
    ...boards.flatMap((board) => boardItems(board, now)),
    ...versionItems(workers),
  ].sort((a, b) =>
    a.level === b.level ? a.id.localeCompare(b.id) : a.level === 'bad' ? -1 : 1,
  );
  const status = items.some((i) => i.level === 'bad')
    ? 'bad'
    : items.length > 0
      ? 'warn'
      : 'ok';

  return { status, items };
}

// The one message a day. Nothing to say → no message at all (an "all is well" every day trains you to stop reading).
export function driftDigest(view: DriftView): string | null {
  if (view.items.length === 0) return null;

  const lines = view.items
    .slice(0, 12)
    .map(
      (i) =>
        `${i.level === 'bad' ? '🔴' : '🟡'} ${i.subject.replace(/^ubuntu-/, '')}: ${i.text}`,
    );
  const more = view.items.length - lines.length;

  return [
    `Дрейф и тихие отказы — ${view.items.length}`,
    ...lines,
    ...(more > 0 ? [`… и ещё ${more}`] : []),
    'Подробности — Платы и Дашборд.',
  ].join('\n');
}
