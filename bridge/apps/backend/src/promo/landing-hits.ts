import { createHmac } from 'node:crypto';

// What the landing page's script reports, and how bridge turns it into a stored event. Pure functions, no I/O.

export const HIT_KINDS = ['view', 'click', 'play'] as const;
export type HitKind = (typeof HIT_KINDS)[number];
export type HitDevice = 'mobile' | 'tablet' | 'desktop';

// Moscow has no daylight saving: a fixed offset is the day boundary the owner sees (and the one the SQL uses via AT TIME ZONE).
export const STATS_TIME_ZONE = 'Europe/Moscow';
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

export interface ParsedHit {
  kind: HitKind;
  lang: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  target: string | null;
  section: string | null;
}

const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|curl|wget|python-requests|httpclient|uptime|monitor|phantomjs|puppeteer|playwright/i;

export function isBotUserAgent(userAgent: string | undefined): boolean {
  return !userAgent || BOT_UA.test(userAgent);
}

export function deviceOf(userAgent: string): HitDevice {
  if (/ipad|tablet/i.test(userAgent)) return 'tablet';
  // Android phones say "Mobile", Android tablets do not.
  if (/android/i.test(userAgent))
    return /mobile/i.test(userAgent) ? 'mobile' : 'tablet';
  if (/mobi|iphone|ipod/i.test(userAgent)) return 'mobile';

  return 'desktop';
}

// The day a moment belongs to, as YYYY-MM-DD in Moscow time.
export function dayKey(at: Date): string {
  return new Date(at.getTime() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

// A pseudonym for one visitor for one day. The day is part of the input, so the same person gets another value tomorrow and visits
// cannot be followed across days; the secret keeps the value from being worked out from an IP address and a user agent alone.
export function visitorId(
  secret: string,
  day: string,
  ip: string,
  userAgent: string,
): string {
  return createHmac('sha256', secret)
    .update(`${day}|${ip}|${userAgent}`)
    .digest('hex')
    .slice(0, 16);
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;

  const text = value.trim().slice(0, max);

  return text === '' ? null : text;
}

// A campaign tag is typed by whoever builds a link, so it is kept to letters, digits and a few separators.
function tag(value: unknown): string | null {
  const text = clip(value, 80);

  return text ? text.replace(/[^\p{L}\p{N}_.\-+ ]/gu, '') || null : null;
}

export function hostOf(value: unknown): string | null {
  const text = clip(value, 2048);

  if (!text) return null;

  try {
    const url = new URL(text);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    return (
      url.hostname
        .toLowerCase()
        .replace(/^www\./, '')
        .slice(0, 80) || null
    );
  } catch {
    return null;
  }
}

// null when the body is not an event this page sends.
export function parseHit(
  body: unknown,
  ownHost: string | null,
): ParsedHit | null {
  if (typeof body !== 'object' || body === null) return null;

  const raw = body as Record<string, unknown>;
  const kind = HIT_KINDS.find((candidate) => candidate === raw.t);

  if (!kind) return null;

  const referrer = hostOf(raw.r);
  const lang = typeof raw.l === 'string' ? raw.l.toLowerCase().slice(0, 2) : '';
  const section = clip(raw.s, 40);

  return {
    kind,
    lang: lang === 'ru' || lang === 'en' ? lang : null,
    referrer: referrer && referrer !== ownHost ? referrer : null,
    utmSource: tag(raw.us),
    utmMedium: tag(raw.um),
    utmCampaign: tag(raw.uc),
    target: kind === 'click' ? hostOf(raw.to) : null,
    section: section && /^[\w-]+$/.test(section) ? section : null,
  };
}
