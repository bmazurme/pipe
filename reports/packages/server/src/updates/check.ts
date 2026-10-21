import type { ReleaseInfoType, UpdateStatusType } from '@reports/shared';

import { describeFetchError } from '../utils/describe-fetch-error';
import { getSettings } from '../settings/props';
import { readInstalledRelease } from './release';

// The first check after a merge waits for bridge to cut the build (download, unzip and re-zip the repository, ~50 s seen);
// giving up earlier only throws that wait away, since bridge finishes and caches the build anyway. Still below apply.ts's DOWNLOAD_TIMEOUT_MS.
export const CHECK_TIMEOUT_MS = 90_000;
// A check costs bridge a download of the repository the first time a build is cut, so it is not repeated at every page load.
export const CHECK_TTL_MS = 30 * 60 * 1000;
// A failed check is remembered only briefly: its cause (a timeout while bridge was cutting a build, a short outage) is usually gone soon.
export const CHECK_FAILURE_TTL_MS = 2 * 60 * 1000;

// What bridge's GET /api/v1/reports-release/info answers (more fields than these; only these are used here).
interface BridgeReleaseInfo extends ReleaseInfoType {
  sha256: string;
  size: number;
}

export interface UpdateCheckerDeps {
  readInstalled: () => ReleaseInfoType | null;
  fetchLatest: () => Promise<BridgeReleaseInfo>;
  now: () => number;
  ttlMs: number;
  // How long a failed check is remembered; CHECK_FAILURE_TTL_MS when not given.
  failureTtlMs?: number;
}

// The owner's API key and bridge's address come from Settings, as for every other call to bridge.
export async function fetchLatestRelease(): Promise<BridgeReleaseInfo> {
  const { bridgeApiUrl, bridgeApiKey, bridgeStorageApiKey } = getSettings();
  const apiKey = bridgeStorageApiKey || bridgeApiKey;

  if (!bridgeApiUrl || !apiKey) {
    throw new Error('Проверка обновлений: укажите адрес bridge и API-ключ на странице Settings');
  }

  const url = new URL('/api/v1/reports-release/info', new URL(bridgeApiUrl).origin);
  const response = await fetch(url, { headers: { 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) }).catch((error) => {
    throw describeFetchError(error, url);
  });

  if (response.status === 403) throw new Error('Обновления доступны только владельцу bridge — ключ из Settings принадлежит другому аккаунту');
  if (response.status === 503) throw new Error('На bridge не настроен доступ к GitHub (GITHUB_REPO / LOOP_GITHUB_TOKEN) — обновление недоступно');
  if (!response.ok) throw new Error(`Bridge вернул ошибку ${response.status} при проверке обновлений`);

  const info = (await response.json()) as Partial<BridgeReleaseInfo>;

  if (typeof info.releaseId !== 'string' || typeof info.sha256 !== 'string') {
    throw new Error('Bridge ответил без идентификатора релиза — на bridge ещё старая версия, обновите его');
  }

  return {
    releaseId: info.releaseId,
    shortId: info.shortId ?? info.releaseId.slice(0, 12),
    version: info.version ?? null,
    sourceSha: info.sourceSha,
    sha256: info.sha256,
    size: Number(info.size ?? 0),
  };
}

const defaultDeps: UpdateCheckerDeps = {
  readInstalled: () => readInstalledRelease(),
  fetchLatest: fetchLatestRelease,
  now: Date.now,
  ttlMs: CHECK_TTL_MS,
  failureTtlMs: CHECK_FAILURE_TTL_MS,
};

// Remembers the answer for a while; a failed check is remembered as well, for a shorter while, so an unreachable bridge is not asked at every call.
export function createUpdateChecker(deps: UpdateCheckerDeps = defaultDeps) {
  let cached: { at: number; status: UpdateStatusType } | null = null;
  let pending: Promise<UpdateStatusType> | null = null;

  async function run(): Promise<UpdateStatusType> {
    const current = deps.readInstalled();
    const checkedAt = new Date(deps.now()).toISOString();

    try {
      const latest = await deps.fetchLatest();

      return {
        current,
        latest: { releaseId: latest.releaseId, shortId: latest.shortId, version: latest.version, sourceSha: latest.sourceSha },
        // An install that cannot say which build it is counts as outdated: updating it is harmless and tells it.
        updateAvailable: current?.releaseId !== latest.releaseId,
        checkedAt,
        error: null,
      };
    } catch (error) {
      return { current, latest: null, updateAvailable: false, checkedAt, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    async status(options: { refresh?: boolean } = {}): Promise<UpdateStatusType> {
      const ttlMs = cached?.status.error != null ? (deps.failureTtlMs ?? CHECK_FAILURE_TTL_MS) : deps.ttlMs;

      if (!options.refresh && cached && deps.now() - cached.at < ttlMs) {
        // The running build can change under a cached answer (an update was applied): re-read it, keep the rest.
        const current = deps.readInstalled();

        return { ...cached.status, current, updateAvailable: cached.status.latest !== null && current?.releaseId !== cached.status.latest.releaseId };
      }

      pending ??= run()
        .then((status) => {
          cached = { at: deps.now(), status };

          return status;
        })
        .finally(() => {
          pending = null;
        });

      return pending;
    },
    forget(): void {
      cached = null;
    },
  };
}

export const updateChecker = createUpdateChecker();
