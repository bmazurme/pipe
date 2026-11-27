import {
  cleanPath,
  describeScope,
  keyHygiene,
  type KeyRow,
  scopeAllows,
} from './api-key-scope';

const free = { machineOnly: false };

describe('scopeAllows', () => {
  it('lets a full key and a boards key through (boards is decided by the route marker)', () => {
    expect(
      scopeAllows(null, { method: 'DELETE', path: '/api/v1/secrets/1' }, free),
    ).toBe(true);
    expect(
      scopeAllows(
        'boards',
        { method: 'POST', path: '/api/v1/boards/report' },
        free,
      ),
    ).toBe(true);
  });

  describe('readonly', () => {
    it('reads, and nothing else', () => {
      expect(
        scopeAllows(
          'readonly',
          { method: 'GET', path: '/api/v1/worker/jobs' },
          free,
        ),
      ).toBe(true);
      expect(
        scopeAllows(
          'readonly',
          { method: 'HEAD', path: '/api/v1/storage' },
          free,
        ),
      ).toBe(true);
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(
          scopeAllows(
            'readonly',
            { method, path: '/api/v1/worker/jobs' },
            free,
          ),
        ).toBe(false);
      }
    });

    it('is refused where a GET hands out a stored secret', () => {
      expect(
        scopeAllows(
          'readonly',
          { method: 'GET', path: '/api/v1/worker/me/config' },
          { machineOnly: true },
        ),
      ).toBe(false);
    });

    it('is refused on a Storage download, which takes the parcel out of Storage', () => {
      expect(
        scopeAllows(
          'readonly',
          { method: 'GET', path: '/api/v1/storage/42/download' },
          free,
        ),
      ).toBe(false);
      expect(
        scopeAllows(
          'readonly',
          { method: 'GET', path: '/api/v1/storage/42/download?x=1' },
          free,
        ),
      ).toBe(false);
      expect(
        scopeAllows(
          'readonly',
          { method: 'GET', path: '/api/v1/storage/42/peek' },
          free,
        ),
      ).toBe(true);
    });

    it('does not mind the case of the method', () => {
      expect(
        scopeAllows(
          'readonly',
          { method: 'get', path: '/api/v1/storage' },
          free,
        ),
      ).toBe(true);
      expect(
        scopeAllows(
          'readonly',
          { method: 'post', path: '/api/v1/storage' },
          free,
        ),
      ).toBe(false);
    });
  });

  describe('reports-sync', () => {
    it('reaches what reports calls, with any method', () => {
      for (const [method, path] of [
        ['POST', '/api/v1/storage'],
        ['GET', '/api/v1/storage/42/download'],
        ['DELETE', '/api/v1/storage/42'],
        ['GET', '/api/v1/time/export/day-offs'],
        ['POST', '/api/v1/time/import/reports'],
        ['GET', '/api/v1/reports-settings/payload'],
        ['GET', '/api/v1/reports-release/info'],
        ['POST', '/api/v1/clients/heartbeat'],
        ['GET', '/api/v1/worker/jobs'],
        ['GET', '/api/v1/health'],
      ]) {
        expect(scopeAllows('reports-sync', { method, path }, free)).toBe(true);
      }
    });

    it('reaches nothing else of the account', () => {
      for (const path of [
        '/api/v1/secrets',
        '/api/v1/auth/api-keys',
        '/api/v1/vpn/status',
        '/api/v1/worker/claude-credentials',
        '/api/v1/worker/me/config',
        '/api/v1/workers',
        '/api/v1/improve/runs',
        '/api/v1/chat/chats',
      ]) {
        expect(scopeAllows('reports-sync', { method: 'GET', path }, free)).toBe(
          false,
        );
      }
    });

    it('does not take a path that only starts with the same letters', () => {
      expect(
        scopeAllows(
          'reports-sync',
          { method: 'GET', path: '/api/v1/storage-admin' },
          free,
        ),
      ).toBe(false);
      expect(
        scopeAllows(
          'reports-sync',
          { method: 'GET', path: '/api/v1/timeline' },
          free,
        ),
      ).toBe(false);
      expect(
        scopeAllows(
          'reports-sync',
          { method: 'GET', path: '/api/v1/worker/jobsx' },
          free,
        ),
      ).toBe(false);
    });

    it('ignores the query string and a trailing slash', () => {
      expect(
        scopeAllows(
          'reports-sync',
          { method: 'GET', path: '/api/v1/storage/?kind=issue' },
          free,
        ),
      ).toBe(true);
    });
  });

  it('cleans a path', () => {
    expect(cleanPath('/a/b/?x=1')).toBe('/a/b');
    expect(cleanPath('/')).toBe('/');
    expect(cleanPath(undefined)).toBe('');
  });

  it('describes a scope in words', () => {
    expect(describeScope(null)).toBe('полный доступ');
    expect(describeScope('readonly')).toBe('только чтение');
  });
});

describe('keyHygiene', () => {
  const NOW = new Date('2026-11-27T12:00:00Z');
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
  const inDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
  const key = (over: Partial<KeyRow> = {}): KeyRow => ({
    id: 1,
    name: 'sync-cli',
    prefix: 'brk_AAAAAAAA',
    createdAt: daysAgo(10),
    lastUsedAt: daysAgo(1),
    expiresAt: inDays(60),
    revokedAt: null,
    notifiedStaleAt: null,
    notifiedExpiringAt: null,
    ...over,
  });

  it('says nothing about a healthy key', () => {
    expect(keyHygiene([key()], NOW)).toEqual([]);
  });

  it('warns a week before a key runs out, once', () => {
    const [finding] = keyHygiene([key({ expiresAt: inDays(6) })], NOW);

    expect(finding).toMatchObject({ id: 1, kind: 'expiring' });
    expect(finding.text).toContain('sync-cli');
    expect(finding.text).toContain('Перевыпустите');
    expect(
      keyHygiene(
        [key({ expiresAt: inDays(6), notifiedExpiringAt: daysAgo(1) })],
        NOW,
      ),
    ).toEqual([]);
    expect(keyHygiene([key({ expiresAt: inDays(8) })], NOW)).toEqual([]);
  });

  it('says nothing about a key that is already expired (it is just dead)', () => {
    expect(
      keyHygiene(
        [key({ expiresAt: daysAgo(1), lastUsedAt: daysAgo(90) })],
        NOW,
      ),
    ).toEqual([]);
  });

  it('warns about a key nobody used for 30 days, once, counting the idle days', () => {
    const [finding] = keyHygiene([key({ lastUsedAt: daysAgo(35) })], NOW);

    expect(finding).toMatchObject({ kind: 'stale' });
    expect(finding.text).toContain('35 дн.');
    expect(
      keyHygiene(
        [key({ lastUsedAt: daysAgo(35), notifiedStaleAt: daysAgo(2) })],
        NOW,
      ),
    ).toEqual([]);
    expect(keyHygiene([key({ lastUsedAt: daysAgo(29) })], NOW)).toEqual([]);
  });

  it('counts a key that was never used from the day it was made', () => {
    expect(
      keyHygiene([key({ lastUsedAt: null, createdAt: daysAgo(31) })], NOW),
    ).toHaveLength(1);
    expect(
      keyHygiene([key({ lastUsedAt: null, createdAt: daysAgo(3) })], NOW),
    ).toEqual([]);
  });

  it('never bothers about a never-expiring key for its term, only for being idle', () => {
    expect(keyHygiene([key({ expiresAt: null })], NOW)).toEqual([]);
    expect(
      keyHygiene([key({ expiresAt: null, lastUsedAt: daysAgo(40) })], NOW),
    ).toHaveLength(1);
  });

  it('says one thing per key per sweep, the nearer one first', () => {
    const findings = keyHygiene(
      [key({ expiresAt: inDays(2), lastUsedAt: daysAgo(40) })],
      NOW,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('expiring');
  });

  it('skips revoked keys', () => {
    expect(
      keyHygiene(
        [key({ revokedAt: daysAgo(1), lastUsedAt: daysAgo(90) })],
        NOW,
      ),
    ).toEqual([]);
  });
});
