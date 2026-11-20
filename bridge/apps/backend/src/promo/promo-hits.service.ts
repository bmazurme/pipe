import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { PromoLandingHit } from './entities/promo-landing-hit.entity';
import {
  dayKey,
  deviceOf,
  hostOf,
  isBotUserAgent,
  parseHit,
  STATS_TIME_ZONE,
  visitorId,
} from './landing-hits';

const DAY_MS = 24 * 60 * 60 * 1000;
// Visits older than this are dropped by the daily clean-up: the dashboard looks at most a year back.
const RETENTION_DAYS = 400;
export const MAX_STATS_DAYS = 365;

export interface HitSource {
  ip: string;
  userAgent: string | undefined;
  // The Origin header the browser sent with the report, if any.
  origin: string | undefined;
}

export interface LandingDay {
  day: string;
  views: number;
  visitors: number;
  clicks: number;
  plays: number;
}

export interface LandingStats {
  days: number;
  from: string;
  to: string;
  // `visitors` is the sum of each day's distinct visitors: the same person on two days counts twice (the pseudonym changes daily).
  totals: { views: number; visitors: number; clicks: number; plays: number };
  daily: LandingDay[];
  sources: { name: string | null; views: number }[];
  campaigns: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    views: number;
    clicks: number;
  }[];
  targets: { name: string | null; clicks: number }[];
  sections: { name: string | null; clicks: number }[];
  langs: { name: string | null; views: number }[];
  devices: { name: string | null; views: number }[];
  lastEventAt: string | null;
}

type Row = Record<string, string | number | null>;

const num = (value: string | number | null | undefined): number =>
  Number(value ?? 0);

@Injectable()
export class PromoHitsService {
  private readonly logger = new Logger(PromoHitsService.name);

  constructor(
    @InjectRepository(PromoLandingHit)
    private readonly hits: Repository<PromoLandingHit>,
    private readonly config: ConfigService,
  ) {}

  // The host of the landing page, to tell its own address from an outside referrer and to refuse reports from other sites.
  private ownHost(): string | null {
    return hostOf(this.config.get<string>('LANDING_URL'));
  }

  private secret(): string {
    return this.config.get<string>('CREDENTIALS_ENC_KEY') || 'promo-hits-dev';
  }

  // Stores one reported event. Returns false for anything that is not a real visit: a bot, another site's page, a malformed body.
  async record(
    body: unknown,
    source: HitSource,
    now: Date = new Date(),
  ): Promise<boolean> {
    const own = this.ownHost();

    if (source.origin && own && hostOf(source.origin) !== own) return false;
    if (isBotUserAgent(source.userAgent)) return false;

    const parsed = parseHit(body, own);

    if (!parsed || !source.userAgent) return false;

    await this.hits.insert({
      at: now,
      ...parsed,
      visitor: visitorId(
        this.secret(),
        dayKey(now),
        source.ip,
        source.userAgent,
      ),
      device: deviceOf(source.userAgent),
    });

    return true;
  }

  async stats(days: number, now: Date = new Date()): Promise<LandingStats> {
    const span = Math.min(Math.max(Math.trunc(days) || 30, 1), MAX_STATS_DAYS);
    const today = dayKey(now);
    const from = dayKey(new Date(now.getTime() - (span - 1) * DAY_MS));
    // The start of the first day in Moscow time.
    const since = new Date(`${from}T00:00:00+03:00`);

    const query = (sql: string): Promise<Row[]> =>
      this.hits.query(sql, [since]) as Promise<Row[]>;
    const day = `to_char(("at" AT TIME ZONE '${STATS_TIME_ZONE}'), 'YYYY-MM-DD')`;

    const [daily, sources, campaigns, targets, sections, langs, devices, last] =
      await Promise.all([
        query(
          `SELECT ${day} AS day,
             COUNT(*) FILTER (WHERE kind = 'view')::int AS views,
             COUNT(DISTINCT visitor) FILTER (WHERE kind = 'view')::int AS visitors,
             COUNT(*) FILTER (WHERE kind = 'click')::int AS clicks,
             COUNT(*) FILTER (WHERE kind = 'play')::int AS plays
           FROM promo_landing_hits WHERE "at" >= $1 GROUP BY 1 ORDER BY 1`,
        ),
        query(
          `SELECT referrer AS name, COUNT(*)::int AS views FROM promo_landing_hits
           WHERE "at" >= $1 AND kind = 'view' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`,
        ),
        query(
          `SELECT "utmSource" AS source, "utmMedium" AS medium, "utmCampaign" AS campaign,
             COUNT(*) FILTER (WHERE kind = 'view')::int AS views,
             COUNT(*) FILTER (WHERE kind = 'click')::int AS clicks
           FROM promo_landing_hits
           WHERE "at" >= $1 AND ("utmSource" IS NOT NULL OR "utmMedium" IS NOT NULL OR "utmCampaign" IS NOT NULL)
           GROUP BY 1, 2, 3 ORDER BY 4 DESC, 5 DESC LIMIT 20`,
        ),
        query(
          `SELECT target AS name, COUNT(*)::int AS clicks FROM promo_landing_hits
           WHERE "at" >= $1 AND kind = 'click' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`,
        ),
        query(
          `SELECT section AS name, COUNT(*)::int AS clicks FROM promo_landing_hits
           WHERE "at" >= $1 AND kind = 'click' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`,
        ),
        query(
          `SELECT lang AS name, COUNT(*)::int AS views FROM promo_landing_hits
           WHERE "at" >= $1 AND kind = 'view' GROUP BY 1 ORDER BY 2 DESC`,
        ),
        query(
          `SELECT device AS name, COUNT(*)::int AS views FROM promo_landing_hits
           WHERE "at" >= $1 AND kind = 'view' GROUP BY 1 ORDER BY 2 DESC`,
        ),
        query(
          `SELECT MAX("at") AS "at" FROM promo_landing_hits WHERE "at" >= $1`,
        ),
      ]);

    // Every day of the period, including the ones nobody visited.
    const byDay = new Map(daily.map((row) => [String(row.day), row]));
    const filled: LandingDay[] = [];

    for (let i = 0; i < span; i += 1) {
      const key = dayKey(new Date(now.getTime() - (span - 1 - i) * DAY_MS));
      const row = byDay.get(key);

      filled.push({
        day: key,
        views: num(row?.views),
        visitors: num(row?.visitors),
        clicks: num(row?.clicks),
        plays: num(row?.plays),
      });
    }

    const sum = (pick: (d: LandingDay) => number) =>
      filled.reduce((total, d) => total + pick(d), 0);
    const lastAt = last[0]?.at;

    return {
      days: span,
      from,
      to: today,
      totals: {
        views: sum((d) => d.views),
        visitors: sum((d) => d.visitors),
        clicks: sum((d) => d.clicks),
        plays: sum((d) => d.plays),
      },
      daily: filled,
      sources: sources.map((r) => ({
        name: r.name as string | null,
        views: num(r.views),
      })),
      campaigns: campaigns.map((r) => ({
        source: r.source as string | null,
        medium: r.medium as string | null,
        campaign: r.campaign as string | null,
        views: num(r.views),
        clicks: num(r.clicks),
      })),
      targets: targets.map((r) => ({
        name: r.name as string | null,
        clicks: num(r.clicks),
      })),
      sections: sections.map((r) => ({
        name: r.name as string | null,
        clicks: num(r.clicks),
      })),
      langs: langs.map((r) => ({
        name: r.name as string | null,
        views: num(r.views),
      })),
      devices: devices.map((r) => ({
        name: r.name as string | null,
        views: num(r.views),
      })),
      lastEventAt: lastAt ? new Date(lastAt as string).toISOString() : null,
    };
  }

  @Interval(6 * 60 * 60 * 1000)
  async cleanup(now: Date = new Date()): Promise<void> {
    try {
      await this.hits.delete({
        at: LessThan(new Date(now.getTime() - RETENTION_DAYS * DAY_MS)),
      });
    } catch (error) {
      this.logger.warn(
        `Landing hits clean-up failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
