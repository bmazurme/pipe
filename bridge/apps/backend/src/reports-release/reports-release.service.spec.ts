import { strToU8, unzip, zip, type Zippable } from 'fflate';

import { ReportsReleaseService } from './reports-release.service';
import type { GithubApiService } from '../loop/github-api.service';

function zipAsync(entries: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(entries, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

function fakeGithubApi(
  overrides: Partial<GithubApiService> = {},
): GithubApiService {
  return {
    isConfigured: () => true,
    getBranchSha: async () => 'abc1234567',
    downloadZipball: async () => new Uint8Array(),
    ...overrides,
  } as unknown as GithubApiService;
}

describe('ReportsReleaseService', () => {
  it('refuses when GitHub is not configured', async () => {
    const service = new ReportsReleaseService(
      fakeGithubApi({ isConfigured: () => false }),
    );

    await expect(service.getInfo()).rejects.toThrow('GITHUB_REPO');
    await expect(service.downloadReportsZip()).rejects.toThrow('GITHUB_REPO');
  });

  it('returns the HEAD sha of main', async () => {
    const service = new ReportsReleaseService(fakeGithubApi());

    await expect(service.getInfo()).resolves.toEqual({
      sha: 'abc1234567',
      shortSha: 'abc1234',
    });
  });

  it('keeps reports/ and packages/protocol/ from the zipball and strips the repo-root prefix', async () => {
    const fakeZipball = await zipAsync({
      'owner-pipe-abc1234/README.md': strToU8('root readme'),
      'owner-pipe-abc1234/bridge/package.json': strToU8('{}'),
      'owner-pipe-abc1234/reports/package.json': strToU8('{"name":"reports"}'),
      'owner-pipe-abc1234/reports/packages/server/src/index.ts':
        strToU8('// entry'),
      'owner-pipe-abc1234/packages/protocol/package.json': strToU8(
        '{"name":"@pipe/protocol"}',
      ),
      'owner-pipe-abc1234/packages/protocol/src/pack.ts':
        strToU8('// protocol source'),
      'owner-pipe-abc1234/harness/package.json': strToU8('{}'),
    });

    const service = new ReportsReleaseService(
      fakeGithubApi({ downloadZipball: async () => fakeZipball }),
    );

    const result = await service.downloadReportsZip();
    const unzipped = await unzipAsync(result);

    expect(Object.keys(unzipped).sort()).toEqual([
      'packages/protocol/package.json',
      'packages/protocol/src/pack.ts',
      'reports/package.json',
      'reports/packages/server/src/index.ts',
    ]);
    expect(Buffer.from(unzipped['reports/package.json']).toString()).toBe(
      '{"name":"reports"}',
    );
    expect(
      Buffer.from(unzipped['packages/protocol/package.json']).toString(),
    ).toBe('{"name":"@pipe/protocol"}');
  });

  it('errors when the branch has no reports/ folder', async () => {
    const fakeZipball = await zipAsync({
      'owner-pipe-abc1234/README.md': strToU8('root readme'),
      'owner-pipe-abc1234/packages/protocol/package.json': strToU8('{}'),
    });

    const service = new ReportsReleaseService(
      fakeGithubApi({ downloadZipball: async () => fakeZipball }),
    );

    await expect(service.downloadReportsZip()).rejects.toThrow('reports/');
  });

  it('errors when the branch has no packages/protocol/ folder', async () => {
    const fakeZipball = await zipAsync({
      'owner-pipe-abc1234/reports/package.json': strToU8('{}'),
    });

    const service = new ReportsReleaseService(
      fakeGithubApi({ downloadZipball: async () => fakeZipball }),
    );

    await expect(service.downloadReportsZip()).rejects.toThrow(
      'packages/protocol/',
    );
  });
});
