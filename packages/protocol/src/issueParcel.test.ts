import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';

import {
  extractSubscriptionArchive,
  SUBSCRIPTION_MANIFEST_ENTRY,
  SYNC_MANIFEST_ENTRY,
  type SubscriptionManifest,
} from './issueParcel.js';
import { buildArchive } from './pack.js';
import type { BaseManifest } from './manifest.js';

interface LegacyManifest extends BaseManifest {
  project: string;
  machine: string;
  createdAt: string;
}

const files = [
  { relPath: 'src/a.ts', content: 'export const a = 1;' },
  { relPath: 'src/nested/b.ts', content: 'export const b = 2;' },
];
const manifestFields = {
  issueId: '1',
  issueIid: '42',
  issueTitle: 'Fix bug',
  issueDescription: 'Details',
  projectId: 173,
  branch: 'user-20260914-42',
  createdAt: '2026-09-14T10:00:00.000Z',
};

function buildSubscription(assets: { relPath: string; base64: string }[] = []): Buffer {
  return buildArchive<SubscriptionManifest>(SUBSCRIPTION_MANIFEST_ENTRY, files, manifestFields, assets).buffer;
}

function buildLegacy(): Buffer {
  return buildArchive<LegacyManifest>(SYNC_MANIFEST_ENTRY, files, {
    project: 'some-project',
    machine: 'host',
    createdAt: '2026-09-14T10:00:00.000Z',
  }).buffer;
}

function tamper(buffer: Buffer): Buffer {
  const zip = new AdmZip(buffer);
  zip.updateFile('src/a.ts', Buffer.from('export const a = 666;', 'utf-8'));
  return zip.toBuffer();
}

describe('extractSubscriptionArchive', () => {
  it('round-trips files and the subscription manifest', () => {
    const { manifest, files: extractedFiles, legacyManifest } = extractSubscriptionArchive(buildSubscription());

    assert.equal(legacyManifest, false);
    assert.equal(manifest.issueId, manifestFields.issueId);
    assert.equal(manifest.issueIid, manifestFields.issueIid);
    assert.equal(manifest.issueTitle, manifestFields.issueTitle);
    assert.equal(manifest.issueDescription, manifestFields.issueDescription);
    assert.equal(manifest.projectId, manifestFields.projectId);
    assert.equal(manifest.branch, manifestFields.branch);
    assert.equal(typeof manifest.contentHash, 'string');
    assert.deepEqual(
      [...extractedFiles].sort((a, b) => a.relPath.localeCompare(b.relPath)),
      [...files].sort((a, b) => a.relPath.localeCompare(b.relPath)),
    );
  });

  it('writes the manifest under the __subscription_manifest__.json entry name', () => {
    const zip = new AdmZip(buildSubscription());
    assert.ok(zip.getEntry('__subscription_manifest__.json'));
  });

  it('round-trips assets separately from files', () => {
    const assets = [{ relPath: 'issue-images/shot.png', base64: Buffer.from([1, 2, 3]).toString('base64') }];
    const { files: extractedFiles, assets: extractedAssets } = extractSubscriptionArchive(buildSubscription(assets));

    assert.equal(extractedFiles.length, files.length);
    assert.deepEqual(extractedAssets, assets);
  });

  it('extracts no assets from an archive built without any', () => {
    assert.deepEqual(extractSubscriptionArchive(buildSubscription()).assets, []);
  });

  it('falls back to the legacy __sync_manifest__.json entry with empty issue fields', () => {
    const { manifest, files: extractedFiles, legacyManifest } = extractSubscriptionArchive(buildLegacy());

    assert.equal(legacyManifest, true);
    assert.equal(manifest.issueId, '');
    assert.equal(manifest.issueTitle, '');
    assert.equal(manifest.branch, '');
    assert.equal(manifest.createdAt, '2026-09-14T10:00:00.000Z');
    assert.equal(typeof manifest.contentHash, 'string');
    assert.equal(extractedFiles.length, files.length);
  });

  it('throws when neither manifest entry is present', () => {
    const zip = new AdmZip();
    zip.addFile('src/a.ts', Buffer.from('x', 'utf-8'));
    assert.throws(() => extractSubscriptionArchive(zip.toBuffer()), /missing both/);
  });

  it('throws on a buffer that is not a zip', () => {
    assert.throws(() => extractSubscriptionArchive(Buffer.from('not a zip')));
  });

  it('rejects a tampered subscription parcel', () => {
    assert.throws(() => extractSubscriptionArchive(tamper(buildSubscription())), /contentHash mismatch/);
  });

  it('rejects a tampered legacy parcel', () => {
    assert.throws(() => extractSubscriptionArchive(tamper(buildLegacy())), /contentHash mismatch/);
  });
});
