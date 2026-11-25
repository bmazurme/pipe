import type { FleetWorker, FleetWorkerState, WorkerJobModel } from '../../store/api';
import { MODEL_OPTIONS } from './constants';

export const WORKER_STATE_LABEL: Record<FleetWorkerState, string> = {
  pending: 'Ждёт подключения',
  offline: 'Не на связи',
  idle: 'Свободен',
  busy: 'Занят',
  paused: 'На паузе',
};

export const WORKER_STATE_THEME: Record<FleetWorkerState, 'normal' | 'info' | 'success' | 'danger' | 'warning'> = {
  pending: 'warning',
  offline: 'danger',
  idle: 'success',
  busy: 'info',
  paused: 'normal',
};

export function modelName(model: WorkerJobModel): string {
  return MODEL_OPTIONS.find((option) => option.value === model)?.content ?? model;
}

export function describeModels(models: WorkerJobModel[] | null): string {
  return models === null ? 'Все модели' : models.map(modelName).join(', ');
}

/** A worker that is connected and not paused: it will answer the next poll. */
export function isOnline(worker: FleetWorker): boolean {
  return worker.state === 'idle' || worker.state === 'busy';
}

/** Is the worker set up for this model? (null = all of them; a legacy worker runs whatever its environment allows.) */
export function canRun(worker: FleetWorker, model: WorkerJobModel): boolean {
  return worker.models === null || worker.models.includes(model);
}

/**
 * The workers a job can be pinned to: the owner's own, switched on, able to run the model. A paused or pending worker is
 * left out (bridge refuses to pin to it); an offline one is allowed — the job simply waits for it.
 */
export function pinnableWorkers(workers: FleetWorker[], model: WorkerJobModel | undefined): FleetWorker[] {
  return workers.filter(
    (worker) =>
      worker.kind === 'managed' &&
      worker.enabled &&
      worker.state !== 'pending' &&
      (model === undefined || canRun(worker, model)),
  );
}

export interface Availability {
  tone: 'success' | 'info' | 'warning' | 'danger';
  text: string;
}

/**
 * What the owner should expect if they start a job right now. Auto (no pin): any connected worker that can run the model —
 * a legacy one included, it takes whatever is not pinned. Pinned: that one worker, however it is doing.
 */
export function describeAvailability(
  workers: FleetWorker[],
  model: WorkerJobModel | undefined,
  pinnedId: number | undefined,
): Availability | null {
  if (workers.length === 0) {
    return {
      tone: 'danger',
      text: "Ни одного worker нет — добавьте его на вкладке «Worker'ы», иначе задача не начнётся.",
    };
  }

  if (pinnedId !== undefined) {
    const pinned = workers.find((worker) => worker.id === pinnedId);

    if (!pinned)
      return {
        tone: 'danger',
        text: 'Выбранного worker больше нет — выберите другого или «Любой свободный».',
      };
    if (pinned.state === 'paused')
      return {
        tone: 'danger',
        text: `«${pinned.name}» на паузе и не возьмёт задачу.`,
      };
    if (pinned.state === 'offline' || pinned.state === 'pending') {
      return {
        tone: 'warning',
        text: `«${pinned.name}» сейчас не на связи — задача подождёт, пока он вернётся.`,
      };
    }
    if (pinned.state === 'busy') {
      return {
        tone: 'info',
        text: `«${pinned.name}» занят — задача начнётся, как только он освободится.`,
      };
    }

    return {
      tone: 'success',
      text: `«${pinned.name}» свободен — задача начнётся через несколько секунд.`,
    };
  }

  if (!model) return null;

  const online = workers.filter(isOnline);
  const candidates = online.filter((worker) => worker.kind === 'legacy' || canRun(worker, model));

  if (candidates.length === 0) {
    const reason =
      online.length === 0
        ? 'Ни один worker не на связи'
        : `Ни один из подключённых worker не настроен на ${modelName(model)}`;

    return {
      tone: 'warning',
      text: `${reason} — задача будет ждать в очереди.`,
    };
  }

  const free = candidates.filter((worker) => worker.state === 'idle').length;

  if (free === 0) {
    return {
      tone: 'info',
      text: `Все подходящие worker заняты (${candidates.length}) — задача встанет в очередь и начнётся, когда освободится первый.`,
    };
  }

  return {
    tone: 'success',
    text: `Свободных worker: ${free} из ${candidates.length} — задача начнётся через несколько секунд.`,
  };
}

/** Counts for the summary strip. */
export function fleetCounts(workers: FleetWorker[]): {
  total: number;
  online: number;
  free: number;
  busy: number;
  paused: number;
  pending: number;
} {
  return {
    total: workers.length,
    online: workers.filter(isOnline).length,
    free: workers.filter((worker) => worker.state === 'idle').length,
    busy: workers.filter((worker) => worker.state === 'busy').length,
    paused: workers.filter((worker) => worker.state === 'paused').length,
    pending: workers.filter((worker) => worker.state === 'pending').length,
  };
}

export const WORKER_IMAGE: string =
  (import.meta.env?.VITE_WORKER_IMAGE as string | undefined) ?? 'ghcr.io/bmazurme/pipe-worker:stable';

export interface EnrollSnippets {
  /** One command on any machine with Docker: starts the worker and joins it. */
  docker: string;
  /** For a worker container that is already running. */
  exec: string;
  /** Without Docker: from a checkout of the repository. */
  node: string;
}

/** The container (and state volume) name for a worker: one machine can run several, each with its own key. */
export function containerName(workerName?: string): string {
  const slug = (workerName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return slug ? `pipe-worker-${slug}` : 'pipe-worker';
}

export function enrollSnippets(
  apiUrl: string,
  code: string,
  image: string = WORKER_IMAGE,
  workerName?: string,
): EnrollSnippets {
  const name = containerName(workerName);

  return {
    docker: [
      // A leftover container of the same name (a reconnect) is replaced; its state volume — and so nothing else — stays.
      `docker rm -f ${name} >/dev/null 2>&1; docker run -d --name ${name} --pull always --restart unless-stopped \\`,
      // A running job gets up to 14 minutes to finish on a stop; Docker's default 10 s would SIGKILL it first.
      '  --stop-timeout 900 -e WORKER_SHUTDOWN_GRACE_SEC=840 \\',
      // A job runs npm ci, the linter and the tests — on a small board that is several cores for minutes, enough to push
      // the machine over its load alarm and to starve whatever else it runs (a Swarm manager, say). Half the cores (at
      // least one), a memory ceiling, and a low priority against everything else on the machine; edit them to taste.
      "  --cpus \"$(docker info --format '{{.NCPU}}' | awk '{c=int($1/2); print (c<1?1:c)}')\" --memory 4g --cpu-shares 512 \\",
      `  -v ${name}-state:/app/.worker-state \\`,
      `  -e BRIDGE_API_URL=${apiUrl} \\`,
      `  -e WORKER_ENROLL_CODE=${code} \\`,
      `  ${image}`,
    ].join('\n'),
    exec: `echo ${code} | docker exec -i ${name} node dist/enrollCli.js -`,
    node: [`export BRIDGE_API_URL=${apiUrl}`, `export WORKER_ENROLL_CODE=${code}`, 'npm start --workspace=worker'].join(
      '\n',
    ),
  };
}
