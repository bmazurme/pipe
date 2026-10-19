import type { ClaudeReport } from './modelRunners/claudeUsage.js';

// Thrown by a model runner when the job's owner asked to stop it. Distinct from
// an ordinary failure: processJob reports status 'cancelled' (no error message, no
// result) instead of 'failed'.
export class CancelledError extends Error {
  // Usage and plan limits the CLI reported before it was stopped.
  readonly report?: ClaudeReport;

  constructor(report?: ClaudeReport) {
    super('Job was stopped by its owner');
    this.report = report;
    this.name = 'CancelledError';
  }
}
