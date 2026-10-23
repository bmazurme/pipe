import { strToU8, unzipSync, zipSync } from 'fflate';

import { readZipball, unzipAsync, unzipBounded, zipAsync } from './zip';

const LIMITS = { maxEntries: 10, maxEntryBytes: 100, maxTotalBytes: 150 };

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

describe('unzipBounded', () => {
  it('unzips an archive within the limits', async () => {
    const out = await unzipBounded(
      zipSync({ 'a.txt': strToU8('a'), 'b.txt': strToU8('b') }),
      LIMITS,
    );

    expect(Object.keys(out).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('refuses too many entries', async () => {
    const entries = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`${i}.txt`, strToU8('x')]),
    );

    await expect(unzipBounded(zipSync(entries), LIMITS)).rejects.toThrow(
      /больше 10 файлов/,
    );
  });

  it('refuses an entry that is too big', async () => {
    await expect(
      unzipBounded(zipSync({ 'big.txt': new Uint8Array(101) }), LIMITS),
    ).rejects.toThrow(/«big\.txt»/);
  });

  it('refuses a total that is too big', async () => {
    await expect(
      unzipBounded(
        zipSync({ 'a.txt': new Uint8Array(80), 'b.txt': new Uint8Array(80) }),
        LIMITS,
      ),
    ).rejects.toThrow(/общий размер/);
  });
});

describe('zipAsync / unzipAsync', () => {
  it('round-trips entries at the level it is given', async () => {
    const text = strToU8('hello '.repeat(1000));
    const stored = await zipAsync({ 'a.txt': text }, 0);
    const deflated = await zipAsync({ 'a.txt': text }, 6);

    expect(deflated.length).toBeLessThan(stored.length);
    expect(unzipSync(stored)['a.txt']).toEqual(text);
    expect((await unzipAsync(deflated))['a.txt']).toEqual(text);
  });
});
