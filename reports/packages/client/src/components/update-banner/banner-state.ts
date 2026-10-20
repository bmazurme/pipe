import type { UpdateProgressType, UpdateStatusType } from '@reports/shared';

// How long after it ended an update's outcome is still worth a banner — an old failure must not nag a week later.
const OUTCOME_FRESH_MS = 15 * 60 * 1000;
const ACTIVE = ['downloading', 'staged', 'applying', 'installing', 'building', 'rolling-back'];

export type BannerState =
  | { kind: 'none' }
  | { kind: 'available'; canUpdate: boolean; blockedReason: string | null }
  | { kind: 'running'; message: string }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string; rolledBack: boolean };

// What the banner shows, from what the server says about the versions and about the update. The update's own progress wins
// over "a new version is available" while it runs, and its outcome is shown only while it is fresh and still relevant.
export function bannerState(status: UpdateStatusType | undefined, progress: UpdateProgressType | null | undefined, now: number): BannerState {
  const age = progress ? now - new Date(progress.updatedAt).getTime() : Infinity;

  if (progress && ACTIVE.includes(progress.phase) && age < OUTCOME_FRESH_MS) return { kind: 'running', message: progress.message };

  // Applied: the build running now is the one the update brought.
  if (progress?.phase === 'done' && age < OUTCOME_FRESH_MS && status?.current?.releaseId === progress.releaseId) {
    return { kind: 'done', message: progress.message };
  }

  if (!status?.updateAvailable || !status.latest) return { kind: 'none' };

  if ((progress?.phase === 'failed' || progress?.phase === 'rolled-back') && age < OUTCOME_FRESH_MS) {
    return { kind: 'failed', message: progress.message, rolledBack: progress.phase === 'rolled-back' };
  }

  return { kind: 'available', canUpdate: status.selfUpdate?.available ?? true, blockedReason: status.selfUpdate?.reason ?? null };
}
