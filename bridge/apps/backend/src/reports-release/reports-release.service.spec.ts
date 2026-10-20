import { createHash } from 'node:crypto';

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

  async function releaseZipball(
    reportsVersion: string | null = '1.4.0',
    extra: Record<string, string> = {},
  ): Promise<Uint8Array> {
    return zipAsync({
      'owner-pipe-abc1234/README.md': strToU8('root readme'),
      'owner-pipe-abc1234/reports/package.json': strToU8(
        JSON.stringify(
          reportsVersion
            ? { name: 'reports', version: reportsVersion }
            : { name: 'reports' },
        ),
      ),
      'owner-pipe-abc1234/reports/src/index.ts': strToU8('// entry'),
      'owner-pipe-abc1234/packages/protocol/package.json': strToU8('{}'),
      ...Object.fromEntries(
        Object.entries(extra).map(([path, text]) => [
          `owner-pipe-abc1234/${path}`,
          strToU8(text),
        ]),
      ),
    });
  }

  it('describes the build on offer: the head of main, a content id, the version and the zip checksum', async () => {
    const zipball = await releaseZipball();
    const service = new ReportsReleaseService(
      fakeGithubApi({ downloadZipball: async () => zipball }),
    );

    const info = await service.getInfo();
    const { bytes } = await service.getRelease();

    expect(info).toMatchObject({
      sha: 'abc1234567',
      shortSha: 'abc1234',
      version: '1.4.0',
      size: bytes.byteLength,
    });
    expect(info.releaseId).toMatch(/^[0-9a-f]{64}$/);
    expect(info.shortId).toBe(info.releaseId.slice(0, 12));
    expect(info.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('keeps the release id when only something outside reports/ and protocol changed — and changes it when they change', async () => {
    const releaseOf = async (zipball: Uint8Array, sha: string) =>
      (
        await new ReportsReleaseService(
          fakeGithubApi({
            getBranchSha: async () => sha,
            downloadZipball: async () => zipball,
          }),
        ).getInfo()
      ).releaseId;

    const base = await releaseOf(await releaseZipball(), 'sha-1');
    const bridgeOnlyChange = await releaseOf(
      await releaseZipball('1.4.0', { 'bridge/src/main.ts': '// changed' }),
      'sha-2',
    );
    const reportsChange = await releaseOf(
      await releaseZipball('1.4.0', { 'reports/src/new.ts': '// new' }),
      'sha-3',
    );
    const protocolChange = await releaseOf(
      await releaseZipball('1.4.0', {
        'packages/protocol/src/new.ts': '// new',
      }),
      'sha-4',
    );

    expect(bridgeOnlyChange).toBe(base);
    expect(reportsChange).not.toBe(base);
    expect(protocolChange).not.toBe(base);
    expect(new Set([base, reportsChange, protocolChange]).size).toBe(3);
  });

  it('writes reports/release.json into the zip: its id, version, source commit and the list of files', async () => {
    const zipball = await releaseZipball();
    const service = new ReportsReleaseService(
      fakeGithubApi({ downloadZipball: async () => zipball }),
    );

    const unzipped = await unzipAsync(await service.downloadReportsZip());
    const manifest = JSON.parse(
      Buffer.from(unzipped['reports/release.json']).toString(),
    );
    const { releaseId } = await service.getInfo();

    expect(manifest).toMatchObject({
      releaseId,
      version: '1.4.0',
      sourceSha: 'abc1234567',
    });
    expect(manifest.files).toEqual([
      'packages/protocol/package.json',
      'reports/package.json',
      'reports/src/index.ts',
    ]);
    // The manifest does not list itself, and so does not change the id it carries.
    expect(manifest.files).not.toContain('reports/release.json');
  });

  it('has no version when reports/package.json has none', async () => {
    const zipball = await releaseZipball(null);
    const service = new ReportsReleaseService(
      fakeGithubApi({ downloadZipball: async () => zipball }),
    );

    expect((await service.getInfo()).version).toBeNull();
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
      'reports/release.json',
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

  describe('caching', () => {
    async function validZipball(): Promise<Uint8Array> {
      return zipAsync({
        'owner-pipe-abc1234/reports/package.json': strToU8('{}'),
        'owner-pipe-abc1234/packages/protocol/package.json': strToU8('{}'),
      });
    }

    it('builds once for the same sha and again for a new one', async () => {
      const zipball = await validZipball();
      const downloadZipball = jest.fn(async () => zipball);
      let sha = 'sha-1';
      const service = new ReportsReleaseService(
        fakeGithubApi({ getBranchSha: async () => sha, downloadZipball }),
      );

      const first = await service.downloadReportsZip();
      const second = await service.downloadReportsZip();

      expect(second).toBe(first);
      expect(downloadZipball).toHaveBeenCalledTimes(1);

      sha = 'sha-2';
      await service.downloadReportsZip();

      expect(downloadZipball).toHaveBeenCalledTimes(2);
    });

    it('shares one build between concurrent calls', async () => {
      const zipball = await validZipball();
      const downloadZipball = jest.fn(async () => zipball);
      const service = new ReportsReleaseService(
        fakeGithubApi({ downloadZipball }),
      );

      await Promise.all([
        service.downloadReportsZip(),
        service.downloadReportsZip(),
      ]);

      expect(downloadZipball).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failed build', async () => {
      const zipball = await validZipball();
      const downloadZipball = jest
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(zipball);
      const service = new ReportsReleaseService(
        fakeGithubApi({ downloadZipball }),
      );

      await expect(service.downloadReportsZip()).rejects.toThrow('boom');
      await expect(service.downloadReportsZip()).resolves.toBeDefined();
      expect(downloadZipball).toHaveBeenCalledTimes(2);
    });
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
