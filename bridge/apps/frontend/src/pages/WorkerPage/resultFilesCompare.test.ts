import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { compareWithSource } from './resultFiles';

describe('compareWithSource', () => {
  it('marks added, modified, unchanged and deleted entries, ignoring manifests', () => {
    const source = zipSync({
      'same.txt': strToU8('s'),
      'edit.txt': strToU8('old'),
      'gone.txt': strToU8('g'),
      '__sync_manifest__.json': strToU8('{"a":1}'),
    });
    const result = zipSync({
      'same.txt': strToU8('s'),
      'edit.txt': strToU8('new!'),
      'new.txt': strToU8('n'),
      '__subscription_manifest__.json': strToU8('{}'),
    });

    expect(compareWithSource(result, source)).toEqual({
      files: [
        { path: 'edit.txt', size: 4, change: 'modified' },
        { path: 'new.txt', size: 1, change: 'added' },
        { path: 'same.txt', size: 1, change: 'unchanged' },
      ],
      deleted: ['gone.txt'],
    });
  });

  it('detects a same-length content change', () => {
    const files = compareWithSource(zipSync({ 'a.txt': strToU8('abc') }), zipSync({ 'a.txt': strToU8('abd') })).files;
    expect(files[0].change).toBe('modified');
  });
});
