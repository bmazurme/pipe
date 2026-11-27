// S5 — what a personal API key may do. A key with no scope is a full key (the same as the owner's browser session, minus what needs a session). The others
// are narrower on purpose: a key left on a laptop, in a CI secret or on a board should reach only what that one job needs.
//
//   boards        — only the routes marked BoardAgentKeyAllowed (the boards' own agent); enforced by the guard through that marker.
//   readonly      — GET/HEAD only, and never a route that hands out a stored secret (MachineOnly) or one whose GET changes something (a Storage download
//                   deletes the parcel: single-recipient mailbox).
//   reports-sync  — what reports' own server calls on bridge: Storage (parcels), the time import/export, its settings and release, the client heartbeat,
//                   the jobs of the worker queue. Nothing else of the account.

export const API_KEY_SCOPES = ['boards', 'readonly', 'reports-sync'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const SCOPE_LABEL: Record<ApiKeyScope, string> = {
  boards: 'только для плат',
  readonly: 'только чтение',
  'reports-sync': 'для reports (sync)',
};

// A key made without saying how long it lives lives this long. «Never» is a choice that has to be made on purpose (expiresInDays: null).
export const DEFAULT_EXPIRY_DAYS = 90;
export const EXPIRY_CHOICES = [30, 90, 365] as const;

const REPORTS_SYNC_PREFIXES = [
  '/api/v1/storage',
  '/api/v1/time',
  '/api/v1/reports-settings',
  '/api/v1/reports-release',
  '/api/v1/clients',
  '/api/v1/worker/jobs',
  '/api/v1/health',
];

const SAFE_METHODS = ['GET', 'HEAD'];

// The path without the query string, without a trailing slash, as Express saw it.
export function cleanPath(path: string | undefined): string {
  const bare = (path ?? '').split('?')[0];

  return bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
}

const underPrefix = (path: string, prefix: string) =>
  path === prefix || path.startsWith(prefix + '/');

// `boards` is decided by the route's own marker, so it is not asked here.
export function scopeAllows(
  scope: ApiKeyScope | null,
  request: { method?: string; path?: string },
  route: { machineOnly: boolean },
): boolean {
  if (scope === null || scope === 'boards') return true;

  const method = (request.method ?? '').toUpperCase();
  const path = cleanPath(request.path);

  if (scope === 'readonly') {
    if (!SAFE_METHODS.includes(method)) return false;
    if (route.machineOnly) return false;

    // GET that is not a read: the download takes the parcel out of Storage.
    return !/^\/api\/v1\/storage\/[^/]+\/download$/.test(path);
  }

  // reports-sync
  return REPORTS_SYNC_PREFIXES.some((prefix) => underPrefix(path, prefix));
}

export function describeScope(scope: ApiKeyScope | null): string {
  return scope ? SCOPE_LABEL[scope] : 'полный доступ';
}

// --------------------------------------------------------------- hygiene

export const STALE_AFTER_DAYS = 30;
export const EXPIRY_WARNING_DAYS = 7;

const DAY_MS = 24 * 60 * 60_000;

export interface KeyRow {
  id: number;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  notifiedStaleAt: Date | null;
  notifiedExpiringAt: Date | null;
}

export interface HygieneFinding {
  id: number;
  kind: 'stale' | 'expiring';
  text: string;
}

const dateOf = (value: Date) =>
  new Date(value).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Moscow',
  });

// Which keys the owner should hear about, each kind once per key: one that runs out within a week, and one nobody has used for a month (it is
// either forgotten — revoke it — or its job broke). A key already expired is neither: it is just dead.
export function keyHygiene(keys: KeyRow[], now: Date): HygieneFinding[] {
  const findings: HygieneFinding[] = [];

  for (const key of keys) {
    if (key.revokedAt) continue;

    const expires = key.expiresAt ? new Date(key.expiresAt).getTime() : null;

    if (expires !== null && expires <= now.getTime()) continue;

    const label = `«${key.name}» (${key.prefix}…)`;

    if (
      expires !== null &&
      expires - now.getTime() <= EXPIRY_WARNING_DAYS * DAY_MS &&
      !key.notifiedExpiringAt
    ) {
      findings.push({
        id: key.id,
        kind: 'expiring',
        text: `⏳ API-ключ ${label} перестанет работать ${dateOf(new Date(expires))}. Перевыпустите его в профиле (Доступ → «Перевыпустить») и обновите там, где он используется.`,
      });

      continue;
    }

    const lastSeen = new Date(key.lastUsedAt ?? key.createdAt).getTime();
    const idleDays = Math.floor((now.getTime() - lastSeen) / DAY_MS);

    if (idleDays >= STALE_AFTER_DAYS && !key.notifiedStaleAt) {
      findings.push({
        id: key.id,
        kind: 'stale',
        text: `💤 API-ключ ${label} не использовался ${idleDays} дн. Не нужен — отзовите (профиль → Доступ); нужен — проверьте, почему тот, кто им пользуется, молчит.`,
      });
    }
  }

  return findings;
}
