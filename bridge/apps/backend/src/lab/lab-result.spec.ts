import { strToU8, zipSync } from 'fflate';

import { diffResult } from '../improve/parcel';
import { sha256 } from '../improve/parcel';
import {
  LAB_MAX_BINARY_FILE_BYTES,
  parcelEntries,
  readLabResult,
  selectLabSnapshot,
  splitBaseline,
  taskWithSkipped,
  withBinaries,
} from './lab-result';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]);

const parcel = () =>
  zipSync({
    'README.md': strToU8('# boat'),
    '__subscription_manifest__.json': strToU8('{}'),
    '__issue_assets__/boats/a/hull.png': PNG,
    '__issue_assets__/boats/b/deck.png': PNG,
    '__issue_assets__/node_modules/x/y.png': PNG,
    'dist/out.js': strToU8('x'),
  });

describe('readLabResult', () => {
  it('keeps the binaries the worker made, with their paths', async () => {
    const result = await readLabResult(parcel());

    expect([...result.binaries.keys()].sort()).toEqual([
      'boats/a/hull.png',
      'boats/b/deck.png',
    ]);
    expect([...result.files.keys()]).toEqual(['README.md']);
  });

  it('adds the binaries to the text changes as additions', async () => {
    const result = await readLabResult(parcel());
    const changes = withBinaries(
      diffResult({ 'README.md': 'old' }, result.files),
      result.binaries,
    );

    expect(changes.map((change) => `${change.kind} ${change.path}`)).toEqual([
      'added boats/a/hull.png',
      'added boats/b/deck.png',
      'modified README.md',
    ]);
    expect(changes[0].bytes).toEqual(PNG);
  });

  it('lets a binary replace a change of the same path', () => {
    const changes = withBinaries(
      [{ path: 'a.png', kind: 'modified', bytes: new Uint8Array([1]) }],
      new Map([['a.png', PNG]]),
    );

    expect(changes).toEqual([{ path: 'a.png', kind: 'added', bytes: PNG }]);
  });
});

describe('the binaries sent to the worker', () => {
  const text = (path: string, body: string) => ({ path, bytes: strToU8(body) });
  const bin = (path: string, size = 6) => ({
    path,
    bytes: new Uint8Array(size).fill(0xff),
  });

  it('sends the images as assets next to the text and records their hashes', () => {
    const snapshot = selectLabSnapshot([
      text('README.md', '# boat'),
      bin('refs/a.png'),
      bin('refs/b.png'),
      bin('node_modules/x.png'),
    ]);

    expect(snapshot.files.map((file) => file.path)).toEqual(['README.md']);
    expect(snapshot.binaries.map((file) => file.path)).toEqual([
      'refs/a.png',
      'refs/b.png',
    ]);
    expect(parcelEntries(snapshot).map((entry) => entry.path)).toEqual([
      'README.md',
      '__issue_assets__/refs/a.png',
      '__issue_assets__/refs/b.png',
    ]);
    expect(snapshot.baseline['__issue_assets__/refs/a.png']).toBe(
      sha256(bin('refs/a.png').bytes),
    );
  });

  it('leaves out a file that is too big and says so in the task', () => {
    const snapshot = selectLabSnapshot([
      bin('refs/big.png', LAB_MAX_BINARY_FILE_BYTES + 1),
      bin('refs/a.png'),
    ]);

    expect(snapshot.binaries.map((file) => file.path)).toEqual(['refs/a.png']);
    expect(taskWithSkipped('Найти эталоны', snapshot.skipped)).toMatch(
      /Найти эталоны[\s\S]*NOT included[\s\S]*refs\/big\.png/,
    );
    expect(taskWithSkipped('Найти эталоны', [])).toBe('Найти эталоны');
  });

  it('does not publish a binary the worker only handed back unchanged', () => {
    const given = splitBaseline(
      selectLabSnapshot([text('README.md', 'x'), bin('refs/a.png')]).baseline,
    );
    const handedBack = new Map([
      ['refs/a.png', bin('refs/a.png').bytes],
      ['out/new.png', PNG],
    ]);

    expect(
      withBinaries([], handedBack, given.binaries).map((change) => change.path),
    ).toEqual(['out/new.png']);
    expect(Object.keys(given.text)).toEqual(['README.md']);
  });

  it('publishes a binary the worker changed', () => {
    const given = { 'refs/a.png': sha256(bin('refs/a.png').bytes) };

    expect(withBinaries([], new Map([['refs/a.png', PNG]]), given)).toEqual([
      { path: 'refs/a.png', kind: 'added', bytes: PNG },
    ]);
  });
});
