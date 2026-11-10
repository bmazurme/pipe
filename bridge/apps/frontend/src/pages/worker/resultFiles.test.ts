import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { listResultFiles, MAX_PREVIEW_BYTES, readResultText } from './resultFiles';

const zip = () =>
  zipSync({
    'b.txt': strToU8('héllo'),
    'a/z.ts': strToU8('x'),
    '__sync_manifest__.json': strToU8('{}'),
    '__subscription_manifest__.json': strToU8('{}'),
    'bin.dat': new Uint8Array([1, 0, 2]),
    'big.txt': new Uint8Array(MAX_PREVIEW_BYTES + 1).fill(65),
  });

describe('resultFiles', () => {
  it('lists files sorted by path with sizes, skipping manifests', () => {
    expect(listResultFiles(zip())).toEqual([
      { path: 'a/z.ts', size: 1 },
      { path: 'b.txt', size: 6 },
      { path: 'big.txt', size: MAX_PREVIEW_BYTES + 1 },
      { path: 'bin.dat', size: 3 },
    ]);
  });

  it('reads text as UTF-8', () => {
    expect(readResultText(zip(), 'b.txt')).toBe('héllo');
  });

  it('returns null for binary, oversize and missing files', () => {
    expect(readResultText(zip(), 'bin.dat')).toBeNull();
    expect(readResultText(zip(), 'big.txt')).toBeNull();
    expect(readResultText(zip(), 'nope')).toBeNull();
  });

  it('throws on a non-zip', () => {
    expect(() => listResultFiles(strToU8('not a zip'))).toThrow();
  });
});
