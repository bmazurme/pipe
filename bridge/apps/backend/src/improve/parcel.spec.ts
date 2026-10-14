import { readFileSync } from 'fs';
import { join } from 'path';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import {
  buildIssueParcel,
  diffResult,
  MANIFEST_ENTRY,
  PARCEL_SCHEMA_VERSION,
  readResultParcel,
  readZipball,
  selectParcelFiles,
  sha256,
  SnapshotFile,
} from './parcel';

const file = (path: string, text: string): SnapshotFile => ({
  path,
  bytes: strToU8(text),
});

describe('readZipball', () => {
  it('strips the top-level folder and ignores directories', async () => {
    const zip = zipSync({
      'owner-repo-abc/': new Uint8Array(),
      'owner-repo-abc/src/a.ts': strToU8('a'),
      'owner-repo-abc/README.md': strToU8('r'),
    });

    expect((await readZipball(zip)).map((entry) => entry.path).sort()).toEqual([
      'README.md',
      'src/a.ts',
    ]);
  });
});

describe('selectParcelFiles', () => {
  it('keeps source and docs', () => {
    expect(
      selectParcelFiles([file('src/a.ts', 'x'), file('README.md', 'y')]),
    ).toHaveLength(2);
  });

  it('drops vendored/generated dirs, lockfiles, binaries and big files', () => {
    const selected = selectParcelFiles([
      file('src/a.ts', 'ok'),
      file('node_modules/pkg/index.js', 'x'),
      file('apps/web/dist/main.js', 'x'),
      file('package-lock.json', '{}'),
      { path: 'logo.png', bytes: new Uint8Array([0xff, 0xfe, 0x00, 0x80]) },
      { path: 'big.txt', bytes: new Uint8Array(300 * 1024).fill(97) },
    ]);

    expect(selected.map((entry) => entry.path)).toEqual(['src/a.ts']);
  });
});

describe('buildIssueParcel / readResultParcel / diffResult', () => {
  const issue = {
    number: 12,
    title: 'Fix x',
    body: 'details',
    repo: 'o/r',
    baseBranch: 'main',
  };
  const files = [
    file('a.ts', 'one'),
    file('b.ts', 'two'),
    file('c.ts', 'three'),
  ];

  it('writes the issue into a manifest the worker recognises, and a baseline of hashes', async () => {
    const { buffer, baseline } = await buildIssueParcel(
      files,
      issue,
      new Date('2026-10-08T00:00:00Z'),
    );
    const read = new Map([...(await readResultParcel(buffer))]);

    expect(read.has('a.ts')).toBe(true);
    expect(read.has(MANIFEST_ENTRY)).toBe(false);
    expect(baseline['a.ts']).toBe(sha256(strToU8('one')));
    expect(Object.keys(baseline)).toHaveLength(3);
  });

  it('stamps the manifest with the current schemaVersion', async () => {
    const { buffer } = await buildIssueParcel(files, issue);
    const manifest = JSON.parse(
      strFromU8(unzipSync(buffer)[MANIFEST_ENTRY]),
    ) as { schemaVersion?: number };

    expect(manifest.schemaVersion).toBe(2);
  });

  it('keeps PARCEL_SCHEMA_VERSION in step with packages/protocol', () => {
    const source = readFileSync(
      join(__dirname, '../../../../../packages/protocol/src/manifest.ts'),
      'utf8',
    );
    const match = /export const PROTOCOL_SCHEMA_VERSION\s*=\s*(\d+)/.exec(
      source,
    );

    expect(match).not.toBeNull();
    expect(PARCEL_SCHEMA_VERSION).toBe(Number(match![1]));
  });

  it('classifies modified, added and deleted files against the baseline', async () => {
    const { baseline } = await buildIssueParcel(files, issue);
    const result = new Map<string, Uint8Array>([
      ['a.ts', strToU8('one')], // untouched
      ['b.ts', strToU8('TWO')], // modified
      ['new.ts', strToU8('n')], // added
      // c.ts gone → deleted
    ]);

    expect(
      diffResult(baseline, result).map((c) => `${c.kind}:${c.path}`),
    ).toEqual(['modified:b.ts', 'deleted:c.ts', 'added:new.ts']);
  });

  it('reports no changes for an untouched result', async () => {
    const { baseline } = await buildIssueParcel(files, issue);

    expect(
      diffResult(baseline, new Map(files.map((f) => [f.path, f.bytes]))),
    ).toEqual([]);
  });

  it('ignores build output and lockfiles a worker leaves behind (they are not a change to publish)', async () => {
    const zip = zipSync({
      'a.ts': strToU8('x'),
      'packages/protocol/dist/index.js': strToU8('built'),
      'apps/backend/dist/tsconfig.tsbuildinfo': strToU8('{}'),
      'node_modules/x/index.js': strToU8('v'),
      'coverage/lcov.info': strToU8('c'),
      'package-lock.json': strToU8('{}'),
      'packages/protocol/tsconfig.tsbuildinfo': strToU8('{}'),
    });

    expect([...(await readResultParcel(zip)).keys()]).toEqual(['a.ts']);
  });

  it('ignores the manifest and binary assets in the worker result', async () => {
    const zip = zipSync({
      'a.ts': strToU8('x'),
      [MANIFEST_ENTRY]: strToU8('{}'),
      '__issue_assets__/img.png': new Uint8Array([1, 2, 3]),
    });

    expect([...(await readResultParcel(zip)).keys()]).toEqual(['a.ts']);
  });

  it('does not block the event loop while building a multi-MB parcel', async () => {
    let seed = 1;
    const big = Array.from({ length: 40 }, (_, i) => {
      const bytes = new Uint8Array(200 * 1024);

      for (let j = 0; j < bytes.length; j++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        bytes[j] = 97 + (seed % 26);
      }

      return { path: `f${i}.txt`, bytes };
    });
    const order: string[] = [];

    setImmediate(() => order.push('immediate'));
    await buildIssueParcel(big, issue).then(() => order.push('parcel'));

    expect(order).toEqual(['immediate', 'parcel']);
  });
});
