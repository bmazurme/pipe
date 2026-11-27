import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { Job } from './entities/job.entity';

// Failures that say nothing about the task itself — the worker process went away.
// The first is what the worker reports on SIGTERM (worker/src/index.ts), the second
// what the sweep writes for a job whose worker never came back.
export const SHUTDOWN_FAILURE_MESSAGE =
  'Worker was stopped (SIGTERM) before the job finished — start it again';
export const LOST_MESSAGE =
  'Worker was restarted or lost while this job was running — the run did not finish';

export const INFRA_FAILURE_MESSAGES: readonly string[] = [
  SHUTDOWN_FAILURE_MESSAGE,
  LOST_MESSAGE,
];

// The one place that decides whether a failed job was lost to infrastructure.
export function isInfraFailure(
  job: Pick<Job, 'failureKind' | 'errorMessage'>,
): boolean {
  if (job.failureKind) return true;

  // Legacy fallback for workers that do not send failureKind yet.
  // TODO: remove once every worker is upgraded.
  return (
    job.errorMessage !== null &&
    INFRA_FAILURE_MESSAGES.includes(job.errorMessage)
  );
}

// The same rule as `isInfraFailure`, as a TypeORM `where` (one branch per way to qualify).
export function infraFailureWhere(
  base: FindOptionsWhere<Job>,
): FindOptionsWhere<Job>[] {
  return [
    { ...base, failureKind: Not(IsNull()) },
    // Legacy fallback for workers that do not send failureKind yet.
    // TODO: remove once every worker is upgraded.
    { ...base, errorMessage: In(INFRA_FAILURE_MESSAGES) },
  ];
}

// R4 — a run that died of the provider having a bad moment, not of the task. The Claude CLI prints these as `API Error: …` and exits non-zero, so
// the worker cannot tell them from a real failure and sends no failureKind; the message is all there is. Deliberately narrow: the tail of a model's
// own output is in the message too, and a task about network code may well print "ECONNRESET" — only what follows `API Error:` counts.
const TRANSIENT_API_ERROR =
  /API Error:\s*(?:5\d\d\b|Connection error|Request timed out|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed)|"type"\s*:\s*"overloaded_error"/i;
// What a retry cannot help (it would only spend the account's quota or hit the same refusal): authentication, a disabled organization, a limit.
export const NOT_WORTH_RETRYING =
  /Failed to authenticate|\b401\b|\b403\b|has disabled Claude subscription access|usage limit|rate limit|limit reached|credit balance|quota|invalid x-api-key/i;

export function isTransientFailure(job: Pick<Job, 'errorMessage'>): boolean {
  const message = job.errorMessage ?? '';

  return TRANSIENT_API_ERROR.test(message) && !NOT_WORTH_RETRYING.test(message);
}

// A failure that says nothing about the task: the worker went away, the network failed, or the provider had a bad moment. These (and only
// these) are started over by themselves, once.
export function isRetryableFailure(
  job: Pick<Job, 'failureKind' | 'errorMessage'>,
): boolean {
  return isInfraFailure(job) || isTransientFailure(job);
}

// How long a retry waits when the cause may still be going on (a provider's bad moment, a network blip); a lost or stopped worker is not
// waited for.
export const TRANSIENT_RETRY_DELAY_MS = 60_000;
// A retry is kept off the worker that just failed it for this long, when another one could take it (a worker that crash-loops or has a bad
// network would otherwise take it right back); after that any worker may.
export const AVOID_WORKER_MS = 10 * 60_000;
// A worker counts as «there» for that purpose when it polled this recently.
export const WORKER_RECENT_MS = 3 * 60_000;
