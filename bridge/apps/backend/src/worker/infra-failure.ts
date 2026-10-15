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
