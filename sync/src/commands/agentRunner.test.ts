import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { StoredFileResponse } from '../types.js';
import { findCandidates } from './agentRunner.js';

function file(overrides: Partial<StoredFileResponse> = {}): StoredFileResponse {
  return {
    id: 1,
    originalName: '402-6.subscription.zip',
    mimeType: 'application/zip',
    size: 100,
    createdAt: '2026-09-30T00:00:00.000Z',
    channel: null,
    taskKey: null,
    direction: null,
    ...overrides,
  };
}

describe('findCandidates', () => {
  it('matches a real GitLab issue parcel (numeric iid)', () => {
    const candidates = findCandidates([file({ originalName: '402-6.subscription.zip' })], undefined);

    assert.deepEqual(candidates, [
      { file: file({ originalName: '402-6.subscription.zip' }), projectId: '402', iid: '6', encrypted: false },
    ]);
  });

  it('matches an encrypted parcel', () => {
    const candidates = findCandidates([file({ originalName: '402-6.subscription.zip.enc' })], undefined);

    assert.equal(candidates[0]?.encrypted, true);
  });

  // Regression test: reports' manually-created parcels (no GitLab issue
  // behind them — see reports/howto.md) use iid "m-<base36>", e.g.
  // "173-m-mup3r0x2.subscription.zip.enc". The pattern used to require the
  // iid segment to be purely numeric (`\d+`), which silently excluded every
  // manual parcel from candidates — "No pending parcels" even though one
  // was sitting right there in bridge storage.
  it('matches a manual parcel whose iid is "m-<base36>", not numeric', () => {
    const candidates = findCandidates(
      [file({ originalName: '173-m-mup3r0x2.subscription.zip.enc' })],
      undefined,
    );

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.projectId, '173');
    assert.equal(candidates[0]?.iid, 'm-mup3r0x2');
    assert.equal(candidates[0]?.encrypted, true);
  });

  it('filters by gitlabProjectId when given', () => {
    const candidates = findCandidates(
      [file({ originalName: '402-6.subscription.zip' }), file({ originalName: '173-m-mup3r0x2.subscription.zip' })],
      '173',
    );

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.projectId, '173');
  });

  it('ignores files that are not subscription parcels', () => {
    assert.deepEqual(findCandidates([file({ originalName: 'random-file.zip' })], undefined), []);
  });

  it('keeps only the newest parcel per issue when more than one is present', () => {
    const older = file({
      id: 1,
      originalName: '402-6.subscription.zip',
      createdAt: '2026-09-30T00:00:00.000Z',
    });
    const newer = file({
      id: 2,
      originalName: '402-6.subscription.zip',
      createdAt: '2026-09-30T01:00:00.000Z',
    });

    const candidates = findCandidates([older, newer], undefined);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.file.id, 2);
  });
});
