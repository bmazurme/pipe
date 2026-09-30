import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildArchive } from '@pipe/protocol';

import {
  buildResultParcel,
  describeTask,
  extractParcel,
  SUBSCRIPTION_MANIFEST_ENTRY,
  SYNC_MANIFEST_ENTRY,
} from './parcel.js';

function buildSubscriptionParcel(): Buffer {
  const { buffer } = buildArchive(
    SUBSCRIPTION_MANIFEST_ENTRY,
    [{ relPath: 'src/index.ts', content: 'console.log("hi")' }],
    {
      issueId: '1',
      issueIid: '6',
      issueTitle: 'Fix the thing',
      issueDescription: 'It is broken',
      projectId: 402,
      branch: 'task/402-6',
      createdAt: '2026-09-30T00:00:00.000Z',
    },
  );
  return buffer;
}

function buildSyncParcel(): Buffer {
  const { buffer } = buildArchive(
    SYNC_MANIFEST_ENTRY,
    [{ relPath: 'src/index.ts', content: 'console.log("hi")' }],
    { project: 'demo', machine: 'laptop', createdAt: '2026-09-30T00:00:00.000Z' },
  );
  return buffer;
}

describe('extractParcel', () => {
  it('recognizes a subscription-shaped parcel', () => {
    const parcel = extractParcel(buildSubscriptionParcel());
    assert.equal(parcel.manifestEntry, SUBSCRIPTION_MANIFEST_ENTRY);
    assert.equal(parcel.manifest.issueTitle, 'Fix the thing');
    assert.equal(parcel.files.length, 1);
  });

  it('recognizes a sync (project-mode) shaped parcel', () => {
    const parcel = extractParcel(buildSyncParcel());
    assert.equal(parcel.manifestEntry, SYNC_MANIFEST_ENTRY);
    assert.equal(parcel.manifest.project, 'demo');
  });

  it('throws a clear error for a zip with neither manifest', () => {
    const { buffer } = buildArchive('__something_else__.json', [], {});
    assert.throws(() => extractParcel(buffer), /no recognized manifest/);
  });
});

describe('describeTask', () => {
  it('builds a prompt from a subscription parcel\'s issue title/description', () => {
    const parcel = extractParcel(buildSubscriptionParcel());
    const prompt = describeTask(parcel);
    assert.match(prompt, /Fix the thing/);
    assert.match(prompt, /It is broken/);
  });

  it('falls back to a generic prompt for a project-mode parcel with no issue text', () => {
    const parcel = extractParcel(buildSyncParcel());
    assert.match(describeTask(parcel), /No task description/);
  });
});

describe('buildResultParcel', () => {
  it('repacks edited files under the same manifest entry/shape', () => {
    const parcel = extractParcel(buildSubscriptionParcel());
    const resultBuffer = buildResultParcel(parcel, [
      { relPath: 'src/index.ts', content: 'console.log("fixed")' },
      { relPath: 'src/new-file.ts', content: 'export const x = 1;' },
    ]);

    const reExtracted = extractParcel(resultBuffer);
    assert.equal(reExtracted.manifestEntry, SUBSCRIPTION_MANIFEST_ENTRY);
    assert.equal(reExtracted.manifest.issueTitle, 'Fix the thing');
    assert.equal(reExtracted.files.length, 2);
    assert.ok(reExtracted.files.some((f) => f.relPath === 'src/new-file.ts'));
  });
});
