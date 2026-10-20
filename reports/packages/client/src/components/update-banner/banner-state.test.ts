import { describe, expect, it } from 'vitest';
import type { UpdateProgressType, UpdateStatusType } from '@reports/shared';

import { bannerState } from './banner-state';

const NOW = Date.UTC(2026, 9, 20, 9, 0, 0);
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

const release = (id: string) => ({ releaseId: id.repeat(64).slice(0, 64), shortId: id.repeat(12), version: '1.0.0' });
const status = (patch: Partial<UpdateStatusType> = {}): UpdateStatusType => ({
  current: release('a'),
  latest: release('b'),
  updateAvailable: true,
  checkedAt: at(10),
  error: null,
  selfUpdate: { available: true, reason: null },
  ...patch,
});
const progress = (phase: UpdateProgressType['phase'], patch: Partial<UpdateProgressType> = {}): UpdateProgressType => ({
  phase,
  message: `phase ${phase}`,
  releaseId: release('b').releaseId,
  startedAt: at(30),
  updatedAt: at(5),
  ...patch,
});

describe('bannerState', () => {
  it('offers the update when there is one and nothing is running', () => {
    expect(bannerState(status(), null, NOW)).toEqual({ kind: 'available', canUpdate: true, blockedReason: null });
  });

  it('says nothing when there is no update, or no answer yet', () => {
    expect(bannerState(status({ updateAvailable: false }), null, NOW)).toEqual({ kind: 'none' });
    expect(bannerState(undefined, null, NOW)).toEqual({ kind: 'none' });
    expect(bannerState(status({ latest: null }), null, NOW)).toEqual({ kind: 'none' });
  });

  it('says so — with the reason — when this install cannot update itself', () => {
    expect(bannerState(status({ selfUpdate: { available: false, reason: 'это git-репозиторий' } }), null, NOW)).toEqual({
      kind: 'available',
      canUpdate: false,
      blockedReason: 'это git-репозиторий',
    });
  });

  it('shows the running update and what it is doing, whichever step it is on', () => {
    for (const phase of ['downloading', 'staged', 'applying', 'installing', 'building', 'rolling-back'] as const) {
      expect(bannerState(status(), progress(phase), NOW)).toEqual({ kind: 'running', message: `phase ${phase}` });
    }
  });

  it('shows the success only while the build running now is the one the update brought, and only for a while', () => {
    const brought = status({ current: release('b'), updateAvailable: false });

    expect(bannerState(brought, progress('done'), NOW)).toEqual({ kind: 'done', message: 'phase done' });
    // an update to another build is not this one's success
    expect(bannerState(status({ current: release('c'), updateAvailable: false }), progress('done'), NOW)).toEqual({ kind: 'none' });
    expect(bannerState(brought, progress('done', { updatedAt: at(3600) }), NOW)).toEqual({ kind: 'none' });
  });

  it('shows a fresh failure — and whether the old version was put back — instead of the plain offer', () => {
    expect(bannerState(status(), progress('failed'), NOW)).toEqual({ kind: 'failed', message: 'phase failed', rolledBack: false });
    expect(bannerState(status(), progress('rolled-back'), NOW)).toEqual({ kind: 'failed', message: 'phase rolled-back', rolledBack: true });
    // an old one is forgotten: the offer is back
    expect(bannerState(status(), progress('failed', { updatedAt: at(3600) }), NOW)).toMatchObject({ kind: 'available' });
  });

  it('forgets a "running" update that has not moved for a long time (a dead one)', () => {
    expect(bannerState(status(), progress('building', { updatedAt: at(3600) }), NOW)).toMatchObject({ kind: 'available' });
  });
});
