import type { GithubApiService } from '../loop/github-api.service';
import { buildResultTree, mapInBatches } from './improve-shared';
import type { Change } from './parcel';

describe('mapInBatches', () => {
  it('keeps the input order', async () => {
    const result = await mapInBatches([1, 2, 3, 4, 5], 2, async (n) => {
      // Earlier items finish later, so a wrong order would show.
      await new Promise((resolve) => setTimeout(resolve, 10 - n));
      return n * 10;
    });

    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it('never has more than `size` calls in flight', async () => {
    let active = 0;
    let peak = 0;

    const result = await mapInBatches(
      Array.from({ length: 10 }, (_, i) => i),
      4,
      async (n) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return n;
      },
    );

    expect(result).toHaveLength(10);
    expect(peak).toBe(4);
  });

  it('returns [] for empty input without calling fn', async () => {
    const fn = jest.fn();

    await expect(mapInBatches([], 4, fn)).resolves.toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects when one item rejects', async () => {
    await expect(
      mapInBatches([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});

describe('buildResultTree', () => {
  const bytesOf = (text: string) => new TextEncoder().encode(text);

  function makeGithub() {
    const github = {
      getCommitTreeSha: jest.fn().mockResolvedValue('base-tree'),
      createBlob: jest.fn(async (bytes: Uint8Array) => {
        return `blob-${new TextDecoder().decode(bytes)}`;
      }),
      createTree: jest.fn().mockResolvedValue('new-tree'),
    };

    return { github, api: github as unknown as GithubApiService };
  }

  it('builds blob entries for modified/added and null sha for deleted, in order', async () => {
    const { github, api } = makeGithub();
    const changes: Change[] = [
      { path: 'a.txt', kind: 'modified', bytes: bytesOf('a') },
      { path: 'gone.txt', kind: 'deleted' },
      { path: 'b.txt', kind: 'added', bytes: bytesOf('b') },
    ];

    await expect(buildResultTree(api, 'base-commit', changes)).resolves.toBe(
      'new-tree',
    );

    expect(github.getCommitTreeSha).toHaveBeenCalledWith('base-commit');
    expect(github.createBlob).toHaveBeenCalledTimes(2);
    expect(github.createBlob).toHaveBeenCalledWith(bytesOf('a'));
    expect(github.createBlob).toHaveBeenCalledWith(bytesOf('b'));
    expect(github.createTree).toHaveBeenCalledWith('base-tree', [
      { path: 'a.txt', mode: '100644', type: 'blob', sha: 'blob-a' },
      { path: 'gone.txt', mode: '100644', type: 'blob', sha: null },
      { path: 'b.txt', mode: '100644', type: 'blob', sha: 'blob-b' },
    ]);
  });

  it('has at most 6 createBlob calls pending at once', async () => {
    const { github, api } = makeGithub();
    let pending = 0;
    let peak = 0;

    github.createBlob.mockImplementation(async () => {
      pending++;
      peak = Math.max(peak, pending);
      await new Promise((resolve) => setTimeout(resolve, 5));
      pending--;
      return 'sha';
    });

    const changes: Change[] = Array.from({ length: 20 }, (_, i) => ({
      path: `f${i}.txt`,
      kind: 'added',
      bytes: bytesOf(String(i)),
    }));

    await buildResultTree(api, 'base-commit', changes);

    expect(github.createBlob).toHaveBeenCalledTimes(20);
    expect(peak).toBe(6);
  });

  it('rejects and never creates the tree when a blob fails', async () => {
    const { github, api } = makeGithub();

    github.createBlob.mockRejectedValue(new Error('blob failed'));

    await expect(
      buildResultTree(api, 'base-commit', [
        { path: 'a.txt', kind: 'added', bytes: bytesOf('a') },
      ]),
    ).rejects.toThrow('blob failed');
    expect(github.createTree).not.toHaveBeenCalled();
  });
});
