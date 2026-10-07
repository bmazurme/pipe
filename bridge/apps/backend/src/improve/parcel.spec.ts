import { strToU8, zipSync } from 'fflate';

import {
  buildIssueParcel,
  diffResult,
  MANIFEST_ENTRY,
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
  it('strips the top-level folder and ignores directories', () => {
    const zip = zipSync({
      'owner-repo-abc/': new Uint8Array(),
      'owner-repo-abc/src/a.ts': strToU8('a'),
      'owner-repo-abc/README.md': strToU8('r'),
    });

    expect(
      readZipball(zip)
        .map((entry) => entry.path)
        .sort(),
    ).toEqual(['README.md', 'src/a.ts']);
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

  it('writes the issue into a manifest the worker recognises, and a baseline of hashes', () => {
    const { buffer, baseline } = buildIssueParcel(
      files,
      issue,
      new Date('2026-10-08T00:00:00Z'),
    );
    const read = new Map([...readResultParcel(buffer)]);

    expect(read.has('a.ts')).toBe(true);
    expect(read.has(MANIFEST_ENTRY)).toBe(false);
    expect(baseline['a.ts']).toBe(sha256(strToU8('one')));
    expect(Object.keys(baseline)).toHaveLength(3);
  });

  it('classifies modified, added and deleted files against the baseline', () => {
    const { baseline } = buildIssueParcel(files, issue);
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

  it('reports no changes for an untouched result', () => {
    const { baseline } = buildIssueParcel(files, issue);

    expect(
      diffResult(baseline, new Map(files.map((f) => [f.path, f.bytes]))),
    ).toEqual([]);
  });

  it('ignores the manifest and binary assets in the worker result', () => {
    const zip = zipSync({
      'a.ts': strToU8('x'),
      [MANIFEST_ENTRY]: strToU8('{}'),
      '__issue_assets__/img.png': new Uint8Array([1, 2, 3]),
    });

    expect([...readResultParcel(zip).keys()]).toEqual(['a.ts']);
  });
});
