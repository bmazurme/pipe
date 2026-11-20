import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';

import type { PromoLandingHit } from './entities/promo-landing-hit.entity';
import { PromoHitsService } from './promo-hits.service';

const BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';

function setup(landingUrl: string | undefined = 'https://proto450.ntlstl.dev') {
  const inserted: Partial<PromoLandingHit>[] = [];
  const repo = {
    insert: jest.fn(async (row: Partial<PromoLandingHit>) => {
      inserted.push(row);
    }),
    delete: jest.fn(async () => undefined),
    query: jest.fn<Promise<unknown[]>, [string, unknown[]?]>(async () => []),
  };
  const config = {
    get: (key: string) => (key === 'LANDING_URL' ? landingUrl : 'secret'),
  } as unknown as ConfigService;
  const service = new PromoHitsService(
    repo as unknown as Repository<PromoLandingHit>,
    config,
  );

  return { service, repo, inserted };
}

describe('PromoHitsService.record', () => {
  it('stores a visit as a pseudonym, never the address or the browser string', async () => {
    const { service, inserted } = setup();

    const stored = await service.record(
      { t: 'view', l: 'ru' },
      {
        ip: '203.0.113.9',
        userAgent: BROWSER,
        origin: 'https://proto450.ntlstl.dev',
      },
      new Date('2026-11-20T10:00:00Z'),
    );

    expect(stored).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      kind: 'view',
      device: 'desktop',
      lang: 'ru',
    });
    expect(inserted[0].visitor).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(inserted[0])).not.toContain('203.0.113.9');
    expect(JSON.stringify(inserted[0])).not.toContain('Macintosh');
  });

  it('counts the same visitor once a day, another one separately', async () => {
    const { service, inserted } = setup();
    const at = new Date('2026-11-20T10:00:00Z');
    const visit = (ip: string) =>
      service.record(
        { t: 'view' },
        { ip, userAgent: BROWSER, origin: undefined },
        at,
      );

    await visit('1.1.1.1');
    await visit('1.1.1.1');
    await visit('2.2.2.2');

    expect(inserted[0].visitor).toBe(inserted[1].visitor);
    expect(inserted[0].visitor).not.toBe(inserted[2].visitor);
  });

  it('ignores bots, other sites and malformed bodies', async () => {
    const { service, repo } = setup();

    expect(
      await service.record(
        { t: 'view' },
        { ip: '1.1.1.1', userAgent: 'Googlebot/2.1', origin: undefined },
      ),
    ).toBe(false);
    expect(
      await service.record(
        { t: 'view' },
        { ip: '1.1.1.1', userAgent: BROWSER, origin: 'https://evil.example' },
      ),
    ).toBe(false);
    expect(
      await service.record(
        { t: 'nope' },
        { ip: '1.1.1.1', userAgent: BROWSER, origin: undefined },
      ),
    ).toBe(false);
    expect(
      await service.record(
        { t: 'view' },
        { ip: '1.1.1.1', userAgent: undefined, origin: undefined },
      ),
    ).toBe(false);
    expect(repo.insert).not.toHaveBeenCalled();
  });
});

describe('PromoHitsService.stats', () => {
  it('fills every day of the period and sums the totals', async () => {
    const { service, repo } = setup();

    repo.query.mockImplementation(async (sql: string) => {
      if (sql.includes('GROUP BY 1 ORDER BY 1')) {
        return [
          { day: '2026-11-19', views: 3, visitors: 2, clicks: 1, plays: 0 },
          { day: '2026-11-20', views: 5, visitors: 4, clicks: 2, plays: 1 },
        ];
      }

      return [];
    });

    const stats = await service.stats(3, new Date('2026-11-20T10:00:00Z'));

    expect(stats.daily.map((d) => d.day)).toEqual([
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
    ]);
    expect(stats.daily[0]).toMatchObject({ views: 0, visitors: 0 });
    expect(stats.totals).toEqual({
      views: 8,
      visitors: 6,
      clicks: 3,
      plays: 1,
    });
    expect(stats.from).toBe('2026-11-18');
    expect(stats.lastEventAt).toBeNull();
  });

  it('keeps the period within 1..365 days', async () => {
    const { service } = setup();

    expect((await service.stats(0)).days).toBe(30);
    expect((await service.stats(9999)).days).toBe(365);
  });
});
