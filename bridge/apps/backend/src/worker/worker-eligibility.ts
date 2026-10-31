import type { WorkerCapability } from './capabilities';
import type { JobModel } from './entities/job.entity';
import type { Worker } from './entities/worker.entity';

// The one place that says which managed worker may take a job: switched on, model allowed by `models` (null = any),
// the required capability present. The pin itself is checked by the caller (create/retry) or in SQL (claim).
export type WorkerEligibilityTarget = Pick<
  Worker,
  'name' | 'enabled' | 'models' | 'capabilities'
> &
  Partial<Pick<Worker, 'id' | 'version'>>;

// The first worker release that knows the 'custom' model. Older ones would take such a job and fail it as an unknown model,
// so they are simply not given one. A worker reports its version on every settings fetch, so an upgrade is noticed within a poll.
export const MIN_CUSTOM_WORKER_VERSION = '0.2.0';

function versionParts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());

  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function workerSupportsCustom(
  version: string | null | undefined,
): boolean {
  const have = version ? versionParts(version) : null;
  const need = versionParts(MIN_CUSTOM_WORKER_VERSION);

  if (!have || !need) return false;

  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] > need[i];
  }

  return true;
}

export function whyWorkerCannotRun(
  worker: WorkerEligibilityTarget,
  job: {
    model: JobModel;
    requiredCapability?: WorkerCapability | null;
    // For a custom job: the workers the key is limited to (null/absent = any).
    allowedWorkerIds?: number[] | null;
  },
): string | null {
  if (!worker.enabled) {
    return `Worker "${worker.name}" is paused`;
  }
  if (worker.models !== null && !worker.models.includes(job.model)) {
    return `Worker "${worker.name}" is not set up to run ${job.model}`;
  }
  if (job.model === 'custom') {
    if (!workerSupportsCustom(worker.version)) {
      return `Worker "${worker.name}" runs an old version (${worker.version ?? 'unknown'}) that does not know custom models — update it`;
    }
    if (
      job.allowedWorkerIds?.length &&
      (worker.id === undefined || !job.allowedWorkerIds.includes(worker.id))
    ) {
      return `The key of this model is not allowed on worker "${worker.name}"`;
    }
  }
  if (
    job.requiredCapability != null &&
    !(worker.capabilities ?? []).includes(job.requiredCapability)
  ) {
    return `Worker "${worker.name}" does not have ${job.requiredCapability}`;
  }

  return null;
}

// Does the worker have this capability (and is it switched on)? Used to refuse a run that could never start.
export function workerHasCapability(
  worker: Pick<Worker, 'enabled' | 'capabilities'>,
  capability: string,
): boolean {
  return (
    worker.enabled &&
    (worker.capabilities ?? []).includes(capability as WorkerCapability)
  );
}

// The SQL clause (starting with " AND") restricting the queued jobs a claiming worker may take. `params` already holds
// $1..$5 with the worker id at $5; this pushes its own parameters. A legacy worker (null) takes only unpinned jobs
// that need no capability.
export function claimEligibilitySql(
  worker:
    | (Pick<Worker, 'models' | 'capabilities'> &
        Partial<Pick<Worker, 'version'>>)
    | null,
  params: unknown[],
): string {
  if (!worker) {
    return ` AND "targetWorkerId" IS NULL AND "requiredCapability" IS NULL AND model::text <> 'custom'`;
  }

  let eligibility = ' AND ("targetWorkerId" IS NULL OR "targetWorkerId" = $5)';

  if (worker.models !== null) {
    params.push(worker.models);
    eligibility += ` AND model::text = ANY($${params.length}::text[])`;
  }

  // A custom job goes only to a worker that knows the model and whose id the job's key allows ($5 is this worker).
  eligibility += workerSupportsCustom(worker.version)
    ? ` AND (model::text <> 'custom' OR "providerCredentialId" IN (SELECT id FROM provider_credentials WHERE "allowedWorkerIds" IS NULL OR $5 = ANY("allowedWorkerIds")))`
    : ` AND model::text <> 'custom'`;

  params.push(worker.capabilities ?? []);
  eligibility += ` AND ("requiredCapability" IS NULL OR "requiredCapability" = ANY($${params.length}::text[]))`;

  return eligibility;
}
