import { strToU8, zipSync } from 'fflate';

import { diffResult } from '../improve/parcel';
import { readLabResult, withBinaries } from './lab-result';

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
