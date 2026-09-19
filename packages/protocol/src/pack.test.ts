import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';

import { buildArchive, extractArchive, type PackedFile, type PackedAsset } from './pack.js';
import { PROTOCOL_SCHEMA_VERSION, type BaseManifest } from './manifest.js';

interface TestManifest extends BaseManifest {
  project: string;
  createdAt: string;
}

const ENTRY = '__test_manifest__.json';

describe('buildArchive / extractArchive', () => {
  const files: PackedFile[] = [
    { relPath: 'src/a.ts', content: 'export const a = 1;' },
    { relPath: 'src/nested/b.ts', content: 'export const b = 2;' },
  ];

  it('round-trips files and the manifest through a zip archive', () => {
    const { buffer } = buildArchive<TestManifest>(ENTRY, files, {
      project: 'demo',
      createdAt: '2026-09-14T10:00:00.000Z',
    });
    const { manifest, files: extractedFiles } = extractArchive<TestManifest>(buffer, ENTRY);

    assert.equal(manifest.project, 'demo');
    assert.equal(manifest.schemaVersion, PROTOCOL_SCHEMA_VERSION);
    assert.equal(typeof manifest.contentHash, 'string');
    assert.deepEqual(extractedFiles, files);
  });

  it('throws when the manifest entry is missing', () => {
    assert.throws(() => extractArchive(Buffer.from('not a zip'), ENTRY));
  });

  it('round-trips assets separately from files, as real bytes, and folds them into contentHash', () => {
    // A 1x1 PNG — arbitrary binary, not valid UTF-8, to prove the round-trip
    // doesn't go through a lossy string decode anywhere.
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const assets: PackedAsset[] = [{ relPath: 'issue-images/screenshot.png', base64: pngBase64 }];

    const withAssets = buildArchive<TestManifest>(
      ENTRY,
      files,
      { project: 'demo', createdAt: '2026-09-14T10:00:00.000Z' },
      assets,
    );
    const withoutAssets = buildArchive<TestManifest>(ENTRY, files, {
      project: 'demo',
      createdAt: '2026-09-14T10:00:00.000Z',
    });

    const { files: extractedFiles, assets: extractedAssets, manifest } = extractArchive<TestManifest>(
      withAssets.buffer,
      ENTRY,
    );

    assert.deepEqual(extractedFiles, files);
    assert.deepEqual(extractedAssets, assets);
    // Same files, but one archive also carries an asset — hashes must differ,
    // or a parcel's own image could change with agent-runner never noticing.
    assert.notEqual(manifest.contentHash, withoutAssets.manifest.contentHash);
  });

  it('extracts no assets from an archive that has none', () => {
    const { buffer } = buildArchive<TestManifest>(ENTRY, files, {
      project: 'demo',
      createdAt: '2026-09-14T10:00:00.000Z',
    });
    const { assets } = extractArchive<TestManifest>(buffer, ENTRY);

    assert.deepEqual(assets, []);
  });

  it('warns but does not throw when reading a legacy manifest with no schemaVersion', () => {
    const { buffer, manifest } = buildArchive<TestManifest>(ENTRY, files, {
      project: 'demo',
      createdAt: '2026-09-14T10:00:00.000Z',
    });
    delete (manifest as Partial<TestManifest>).schemaVersion;

    // Re-encode the archive by hand with the now-legacy (versionless) manifest.
    const zip = new AdmZip(buffer);
    zip.updateFile(ENTRY, Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

    const { manifest: extracted } = extractArchive<TestManifest>(zip.toBuffer(), ENTRY);
    assert.equal(extracted.schemaVersion, undefined);
  });

  it('throws a descriptive error for a manifest from a newer schema version', () => {
    const { buffer, manifest } = buildArchive<TestManifest>(ENTRY, files, {
      project: 'demo',
      createdAt: '2026-09-14T10:00:00.000Z',
    });
    (manifest as TestManifest).schemaVersion = PROTOCOL_SCHEMA_VERSION + 1;

    const zip = new AdmZip(buffer);
    zip.updateFile(ENTRY, Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

    assert.throws(() => extractArchive<TestManifest>(zip.toBuffer(), ENTRY), /schemaVersion/);
  });
});
