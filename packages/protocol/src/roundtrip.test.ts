// Interop test: sync and reports each parameterize buildArchive/extractArchive
// with their own manifest shape and entry name, but both now go through the
// exact same pack/dictionary code. This proves a parcel built by one side's
// shape is read correctly through the shared machinery the other side also
// uses — the "format drifts silently between the two repos" risk item 5 is
// actually about.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildArchive, extractArchive, type PackedFile } from './pack.js';
import type { BaseManifest } from './manifest.js';
import { applyDictionary } from './dictionary.js';

// Mirrors sync/src/types.ts SyncManifest.
interface SyncManifest extends BaseManifest {
  project: string;
  machine: string;
  createdAt: string;
}
const SYNC_ENTRY = '__sync_manifest__.json';

// Mirrors reports' packages/server/src/subscription/pack.ts SubscriptionManifest.
interface SubscriptionManifest extends BaseManifest {
  issueId: string;
  issueIid: string;
  issueTitle: string;
  issueDescription: string;
  projectId: number;
  branch: string;
  createdAt: string;
}
const SUBSCRIPTION_ENTRY = '__subscription_manifest__.json';

const files: PackedFile[] = [{ relPath: 'src/index.ts', content: 'export const answer = 42;' }];

describe('cross-repo manifest round trip', () => {
  it('reads a sync-shaped parcel back with no loss', () => {
    const { buffer } = buildArchive<SyncManifest>(SYNC_ENTRY, files, {
      project: 'demo',
      machine: 'host-a',
      createdAt: '2026-09-16T00:00:00.000Z',
    });

    const { manifest, files: read } = extractArchive<SyncManifest>(buffer, SYNC_ENTRY);

    assert.equal(manifest.project, 'demo');
    assert.equal(manifest.machine, 'host-a');
    assert.equal(manifest.schemaVersion, 1);
    assert.deepEqual(read, files);
  });

  it('reads a reports-shaped (subscription) parcel back with no loss', () => {
    const { buffer } = buildArchive<SubscriptionManifest>(SUBSCRIPTION_ENTRY, files, {
      issueId: '14324',
      issueIid: '628',
      issueTitle: '{{ISSUE_TITLE}}',
      issueDescription: '{{ISSUE_DESCRIPTION}}',
      projectId: 173,
      branch: 'b-mazur-16.09.2026-628',
      createdAt: '2026-09-16T00:00:00.000Z',
    });

    const { manifest, files: read } = extractArchive<SubscriptionManifest>(buffer, SUBSCRIPTION_ENTRY);

    assert.equal(manifest.projectId, 173);
    assert.equal(manifest.branch, 'b-mazur-16.09.2026-628');
    assert.equal(manifest.schemaVersion, 1);
    assert.deepEqual(read, files);
  });

  it('round-trips a dictionary-substituted manifest field end to end (push -> pull)', () => {
    const toRemote = new Map([['ClearingIdentifier', '{{ENTITY}}']]);
    const toLocal = new Map([...toRemote].map(([k, v]) => [v, k]));

    const realTitle = 'Карточка ClearingIdentifier. Отображение активности.';
    const anonymizedTitle = applyDictionary(realTitle, toRemote).result;

    const { buffer } = buildArchive<SubscriptionManifest>(SUBSCRIPTION_ENTRY, files, {
      issueId: '14324',
      issueIid: '628',
      issueTitle: anonymizedTitle,
      issueDescription: '',
      projectId: 173,
      branch: 'b-mazur-16.09.2026-628',
      createdAt: '2026-09-16T00:00:00.000Z',
    });

    const { manifest } = extractArchive<SubscriptionManifest>(buffer, SUBSCRIPTION_ENTRY);
    const recoveredTitle = applyDictionary(manifest.issueTitle, toLocal).result;

    assert.equal(recoveredTitle, realTitle);
  });
});
