// Thrown by a model runner when the job's owner asked to stop it. Distinct from
// an ordinary failure: processJob reports status 'cancelled' (no error message, no
// result) instead of 'failed'.
export class CancelledError extends Error {
  constructor() {
    super('Job was stopped by its owner');
    this.name = 'CancelledError';
  }
}
