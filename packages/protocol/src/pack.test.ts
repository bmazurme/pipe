import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';

import { createHash } from 'node:crypto';

import { buildArchive, contentHash, extractArchive, type PackedFile, type PackedAsset } from './pack.js';
import { PROTOCOL_SCHEMA_VERSION, type BaseManifest } from './manifest.js';

interface TestManifest extends BaseManifest {
  project: string;
  createdAt: string;
}

const ENTRY = '__test_manifest__.json';

describe('contentHash ordering', () => {
  // Mixed case, underscore, digits, Cyrillic. Code-unit order is:
  // digits < uppercase < '_' < lowercase < Cyrillic. localeCompare would
  // interleave these differently (e.g. 'a' before 'B', '_' before digits).
  const files: PackedFile[] = [
    { relPath: 'b.txt', content: 'b' },
    { relPath: 'Zeta.txt', content: 'Z' },
    { relPath: 'файл.txt', content: 'ф' },
    { relPath: '_private.txt', content: '_' },
    { relPath: '10.txt', content: '10' },
    { relPath: 'Alpha.txt', content: 'A' },
    { relPath: 'a.txt', content: 'a' },
    { relPath: 'Файл.txt', content: 'Ф' },
  ];
  const expectedOrder = [
    '10.txt',
    'Alpha.txt',
    'Zeta.txt',
    '_private.txt',
    'a.txt',
    'b.txt',
    'Файл.txt',
    'файл.txt',
  ];

  function expectedHash(): string {
    const hash = createHash('sha256');
    for (const relPath of expectedOrder) {
      const file = files.find((f) => f.relPath === relPath)!;
      hash.update(`${file.relPath}\0${file.content}\0`);
    }
    return hash.digest('hex');
  }

  it('hashes files in code-unit order of relPath, independent of locale', () => {
    assert.equal(contentHash(files), expectedHash());
  });

  it('is independent of input order', () => {
    const reversed = [...files].reverse();
    const rotated = [...files.slice(3), ...files.slice(0, 3)];
    assert.equal(contentHash(reversed), contentHash(files));
    assert.equal(contentHash(rotated), contentHash(files));
  });

  it('treats entries with the same path as equal rather than reordering them', () => {
    const duplicates: PackedFile[] = [
      { relPath: 'same.txt', content: 'x' },
      { relPath: 'same.txt', content: 'x' },
    ];

    assert.equal(contentHash(duplicates), contentHash([...duplicates].reverse()));
  });

  it('orders assets the same way', () => {
    const assets: PackedAsset[] = [
      { relPath: 'b.png', base64: 'Yg==' },
      { relPath: 'B.png', base64: 'Qg==' },
      { relPath: '_c.png', base64: 'Xw==' },
    ];
    assert.equal(contentHash([], assets), contentHash([], [...assets].reverse()));
  });
});

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

  it('throws when the manifest entry is missing from an otherwise valid zip', () => {
    const zip = new AdmZip();
    zip.addFile('src/a.ts', Buffer.from('export const a = 1;', 'utf-8'));

    assert.throws(() => extractArchive(zip.toBuffer(), ENTRY), /Archive is missing __test_manifest__\.json/);
  });

  it('throws on input that is not a zip at all', () => {
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

  it('throws when a file entry was altered after the archive was built', () => {
    const { buffer } = buildArchive<TestManifest>(ENTRY, files, {
      project: 'demo',
      createdAt: '2026-09-14T10:00:00.000Z',
    });
    const zip = new AdmZip(buffer);
    zip.updateFile('src/a.ts', Buffer.from('export const a = 999;', 'utf-8'));

    assert.throws(
      () => extractArchive<TestManifest>(zip.toBuffer(), ENTRY),
      /failed integrity check: contentHash mismatch/,
    );
  });

  it('still extracts a manifest that has no contentHash', () => {
    const { buffer, manifest } = buildArchive<TestManifest>(ENTRY, files, {
      project: 'demo',
      createdAt: '2026-09-14T10:00:00.000Z',
    });
    delete (manifest as Partial<TestManifest>).contentHash;

    const zip = new AdmZip(buffer);
    zip.updateFile(ENTRY, Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

    const { files: extractedFiles } = extractArchive<TestManifest>(zip.toBuffer(), ENTRY);
    assert.deepEqual(extractedFiles, files);
  });
});
