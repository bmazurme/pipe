import { createHash } from 'node:crypto';

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { strToU8, unzip, zip, type Unzipped, type Zippable } from 'fflate';

import { SharedAsyncCache } from '../common/shared-async-cache';
import { GithubApiService } from '../loop/github-api.service';

const BASE_BRANCH = 'main';
// How long the resolved head of main is trusted before GitHub is asked again.
const SHA_TTL_MS = 60_000;
// reports/package.json depends on @pipe/protocol via a plain relative
// `file:../../../packages/protocol` path (not rewritten here, not a
// workspace range) — bundling protocol alongside reports/, at the same
// relative depth it has in the real monorepo, makes that path resolve
// correctly in the extracted zip with no rewriting needed.
const INCLUDED_SEGMENTS = ['reports/', 'packages/protocol/'];

// What the owner's reports needs to know about the build on offer. The release id is a hash of the CONTENT that goes into
// the zip (reports/ and packages/protocol/), not of a commit: a merge elsewhere in the repository (bridge, worker, docs)
// leaves it unchanged, so "a new version is available" is only ever said when reports itself changed.
export interface ReportsReleaseInfo {
  // The head of main this build was cut from.
  sha: string;
  shortSha: string;
  releaseId: string;
  shortId: string;
  // reports/package.json's version — for people to read, never compared.
  version: string | null;
  // Of the zip itself, so the receiver can check what it downloaded.
  sha256: string;
  size: number;
}

// What the zip carries as reports/release.json: the receiver reads its own version from it, and uses `files` to remove
// what a later release no longer has.
export interface ReleaseManifest {
  releaseId: string;
  shortId: string;
  version: string | null;
  sourceSha: string;
  files: string[];
}

export const RELEASE_MANIFEST_PATH = 'reports/release.json';

interface BuiltRelease {
  sha: string;
  bytes: Uint8Array;
  info: ReportsReleaseInfo;
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
  // Single-entry cache: the output depends only on the base SHA.
  private readonly releases = new SharedAsyncCache<BuiltRelease>({
    maxEntries: 1,
  });

  private readonly logger = new Logger(ReportsReleaseService.name);
  // The last release that was built successfully: `info` answers from it while a newer one is being built.
  private lastBuilt: BuiltRelease | null = null;
  private resolvedSha: { promise: Promise<string>; at: number } | null = null;

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

    const sha = await this.resolveSha();
    const last = this.lastBuilt;

    if (!last) return (await this.buildFor(sha)).info;
    if (last.sha === sha) return last.info;

    // main moved: build the new release in the background and answer with the previous one.
    this.buildFor(sha).catch((err: unknown) => {
      this.logger.warn(
        `Фоновая сборка reports-release для ${sha.slice(0, 7)} не удалась: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    return last.info;
  }

  private resolveSha(): Promise<string> {
    const cached = this.resolvedSha;

    if (cached && Date.now() - cached.at < SHA_TTL_MS) return cached.promise;

    const promise = this.githubApi.getBranchSha(BASE_BRANCH);
    const entry = { promise, at: Date.now() };

    this.resolvedSha = entry;
    promise.catch(() => {
      if (this.resolvedSha === entry) this.resolvedSha = null;
    });

    return promise;
  }

  private async buildFor(sha: string): Promise<BuiltRelease> {
    const built = await this.releases.get(sha, () => this.buildReportsZip(sha));

    this.lastBuilt = built;

    return built;
  }

  // Re-packs reports/ plus packages/protocol/ out of the whole-repo zipball
  // — everything reports/package.json's dependency graph needs — so the
  // result can be unzipped standalone (no other part of the monorepo
  // required) and built with the usual `npm install && npm run build` in
  // each of the two folders. protocol's dist/ is gitignored, so it still
  // isn't prebuilt inside the zip; there is no way around that short of
  // compiling it server-side here, which this deliberately doesn't do.
  async downloadReportsZip(): Promise<Uint8Array> {
    return (await this.getRelease()).bytes;
  }

  async getRelease(): Promise<{ bytes: Uint8Array; info: ReportsReleaseInfo }> {
    this.assertConfigured();

    return this.buildFor(await this.resolveSha());
  }

  private async buildReportsZip(sha: string): Promise<BuiltRelease> {
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

    const files = Object.keys(output).sort();
    const releaseId = hashContents(output as Record<string, Uint8Array>, files);
    const manifest: ReleaseManifest = {
      releaseId,
      shortId: releaseId.slice(0, 12),
      version: readVersion(
        output['reports/package.json'] as Uint8Array | undefined,
      ),
      sourceSha: sha,
      files,
    };

    output[RELEASE_MANIFEST_PATH] = strToU8(JSON.stringify(manifest, null, 2));

    const bytes = await zipAsync(output);

    return {
      sha,
      bytes,
      info: {
        sha,
        shortSha: sha.slice(0, 7),
        releaseId,
        shortId: manifest.shortId,
        version: manifest.version,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.byteLength,
      },
    };
  }
}

// The id of a release: the paths and bytes of every file that goes into the zip, in path order.
function hashContents(
  entries: Record<string, Uint8Array>,
  sortedPaths: string[],
): string {
  const hash = createHash('sha256');

  for (const path of sortedPaths) {
    const content = entries[path];

    hash
      .update(path)
      .update('\0')
      .update(String(content.byteLength))
      .update('\0')
      .update(content);
  }

  return hash.digest('hex');
}

function readVersion(packageJson: Uint8Array | undefined): string | null {
  if (!packageJson) return null;

  try {
    const { version } = JSON.parse(Buffer.from(packageJson).toString()) as {
      version?: unknown;
    };

    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}
