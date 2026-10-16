// A delta poll asks for what changed since the newest `updatedAt` already held — minus a few seconds. Rows are merged by id, so
// asking for the same row twice is harmless, while the overlap covers a write that was committed just after the previous poll but
// carries an earlier timestamp (a row is stamped when its transaction starts, not when it commits), which would otherwise be
// missed until that row changes again.
export const DELTA_OVERLAP_MS = 5000;

export function deltaSince(newestUpdatedAt: string): string {
  const time = new Date(newestUpdatedAt).getTime();

  return Number.isNaN(time) ? newestUpdatedAt : new Date(time - DELTA_OVERLAP_MS).toISOString();
}
