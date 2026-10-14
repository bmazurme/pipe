import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { unzip, zip, type Unzipped, type Zippable } from 'fflate';

import { GithubApiService } from '../loop/github-api.service';

const BASE_BRANCH = 'main';
// reports/package.json depends on @pipe/protocol via a plain relative
// `file:../../../packages/protocol` path (not rewritten here, not a
// workspace range) — bundling protocol alongside reports/, at the same
// relative depth it has in the real monorepo, makes that path resolve
// correctly in the extracted zip with no rewriting needed.
const INCLUDED_SEGMENTS = ['reports/', 'packages/protocol/'];

export interface ReportsReleaseInfo {
  sha: string;
  shortSha: string;
}

// fflate's callback forms run on worker threads in Node — see improve/parcel.ts
// for the same pattern (this module deliberately doesn't import from there:
// parcel.ts's helpers are module-private and shaped around a different,
// worker-job-specific manifest).
function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

function zipAsync(entries: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(entries, { level: 6 }, (err, out) =>
      err ? reject(err) : resolve(out),
    );
  });
}

@Injectable()
export class ReportsReleaseService {
  constructor(private readonly githubApi: GithubApiService) {}

  private assertConfigured(): void {
    if (!this.githubApi.isConfigured()) {
      throw new ServiceUnavailableException(
        'GitHub не настроен: задайте GITHUB_REPO и LOOP_GITHUB_TOKEN на bridge',
      );
    }
  }

  async getInfo(): Promise<ReportsReleaseInfo> {
    this.assertConfigured();

    const sha = await this.githubApi.getBranchSha(BASE_BRANCH);

    return { sha, shortSha: sha.slice(0, 7) };
  }

  // Re-packs reports/ plus packages/protocol/ out of the whole-repo zipball
  // — everything reports/package.json's dependency graph needs — so the
  // result can be unzipped standalone (no other part of the monorepo
  // required) and built with the usual `npm install && npm run build` in
  // each of the two folders. protocol's dist/ is gitignored, so it still
  // isn't prebuilt inside the zip; there is no way around that short of
  // compiling it server-side here, which this deliberately doesn't do.
  async downloadReportsZip(): Promise<Uint8Array> {
    this.assertConfigured();

    const sha = await this.githubApi.getBranchSha(BASE_BRANCH);
    const zipball = await this.githubApi.downloadZipball(sha);
    const unzipped = await unzipAsync(zipball);
    const paths = Object.keys(unzipped);

    if (paths.length === 0) {
      throw new Error('GitHub вернул пустой архив');
    }

    // GitHub names the zipball's single root folder "<owner>-<repo>-<shortsha>/".
    const rootPrefix = `${paths[0].split('/')[0]}/`;
    const includedPrefixes = INCLUDED_SEGMENTS.map(
      (segment) => `${rootPrefix}${segment}`,
    );

    const output: Zippable = {};

    for (const path of paths) {
      if (
        path.endsWith('/') ||
        !includedPrefixes.some((prefix) => path.startsWith(prefix))
      )
        continue;

      output[path.slice(rootPrefix.length)] = unzipped[path];
    }

    if (!Object.keys(output).some((path) => path.startsWith('reports/'))) {
      throw new Error('В репозитории не нашлось папки reports/');
    }

    if (
      !Object.keys(output).some((path) => path.startsWith('packages/protocol/'))
    ) {
      throw new Error('В репозитории не нашлось папки packages/protocol/');
    }

    return zipAsync(output);
  }
}
