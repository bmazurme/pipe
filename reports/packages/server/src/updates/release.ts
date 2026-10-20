import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

import type { ReleaseInfoType } from '@reports/shared';

// reports/ — the folder that holds run.sh, package.json and packages/ (this file is reports/packages/server/src/updates/).
export const REPORTS_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export const RELEASE_FILE = 'release.json';

// What bridge writes next to package.json when it cuts the zip: this build's id, its version and the files it consists of.
export interface ReleaseManifest extends ReleaseInfoType {
  files: string[];
}

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

// The release this install came from, or null when it carries none (an install from before versioning, a git checkout).
export function readInstalledManifest(root: string = REPORTS_ROOT): ReleaseManifest | null {
  try {
    const raw = JSON.parse(readFileSync(join(root, RELEASE_FILE), 'utf-8')) as Partial<ReleaseManifest>;

    if (!isString(raw.releaseId)) return null;

    return {
      releaseId: raw.releaseId,
      shortId: isString(raw.shortId) ? raw.shortId : raw.releaseId.slice(0, 12),
      version: isString(raw.version) ? raw.version : null,
      sourceSha: isString(raw.sourceSha) ? raw.sourceSha : undefined,
      files: Array.isArray(raw.files) ? raw.files.filter(isString) : [],
    };
  } catch {
    return null;
  }
}

export function readInstalledRelease(root: string = REPORTS_ROOT): ReleaseInfoType | null {
  const manifest = readInstalledManifest(root);

  return manifest ? { releaseId: manifest.releaseId, shortId: manifest.shortId, version: manifest.version, sourceSha: manifest.sourceSha } : null;
}

// reports/package.json's own version — what a person calls "the version" even when no release.json says more.
export function readPackageVersion(root: string = REPORTS_ROOT): string | null {
  try {
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { version?: unknown };

    return isString(version) ? version : null;
  } catch {
    return null;
  }
}
