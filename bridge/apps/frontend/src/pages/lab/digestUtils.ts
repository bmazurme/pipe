import type { LabDigest, LabDigestSource, LabDigestStatus } from '../../store/api';

const DAY_MS = 24 * 60 * 60 * 1000;
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

const dateOnly = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// The Monday (YYYY-MM-DD, Moscow time — the week of the owner, same as bridge's) of the week `date` falls in.
export function weekStartOf(date: Date): string {
  const day = dateOnly(date.getTime() + MOSCOW_OFFSET_MS);
  const midnight = new Date(`${day}T00:00:00Z`).getTime();
  const back = (new Date(midnight).getUTCDay() + 6) % 7;

  return dateOnly(midnight - back * DAY_MS);
}

// The current week and the ones before it, newest first.
export function recentWeeks(now: Date, count: number): string[] {
  const weeks: string[] = [];
  let week = new Date(`${weekStartOf(now)}T00:00:00Z`).getTime();

  for (let i = 0; i < count; i += 1) {
    weeks.push(dateOnly(week));
    week -= 7 * DAY_MS;
  }

  return weeks;
}

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayMonthShort = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// "9–15 ноября 2026", or "30 нояб. – 6 дек. 2026" when the week crosses a month.
export function weekLabel(weekStart: string): string {
  const from = new Date(`${weekStart}T00:00:00Z`);
  const to = new Date(from.getTime() + 6 * DAY_MS);
  const year = to.getUTCFullYear();

  if (from.getUTCMonth() === to.getUTCMonth()) {
    return `${from.getUTCDate()}–${dayMonth.format(to)} ${year}`;
  }

  return `${dayMonthShort.format(from)} – ${dayMonthShort.format(to)} ${year}`;
}

export const DIGEST_STATUS_LABEL: Record<LabDigestStatus, string> = {
  generating: 'Собирается',
  draft: 'Черновик',
  exported: 'Перенесён в notes',
  failed: 'Ошибка',
};

export const DIGEST_STATUS_THEME: Record<LabDigestStatus, 'info' | 'warning' | 'success' | 'danger'> = {
  generating: 'info',
  draft: 'warning',
  exported: 'success',
  failed: 'danger',
};

export const SOURCE_LABEL: Record<LabDigestSource, string> = {
  lab: 'Lab',
  improve: 'Improve',
  parcel: 'Посылка',
};

// Parses 'a, b ,#c' into tags the way bridge does (lowercase, no hash, no spaces); the server tidies them again.
export function parseTags(text: string): string[] {
  const seen = new Set<string>();

  for (const part of text.split(',')) {
    const tag = part.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-');

    if (tag) seen.add(tag);
  }

  return [...seen].slice(0, 8);
}

// The note as one file for notes.ntlstl.dev: the fields it asks for in a header, then the text.
export function digestMarkdownFile(digest: Pick<LabDigest, 'title' | 'preview' | 'content' | 'tags' | 'noteType'>): string {
  const header = [
    '---',
    `title: ${JSON.stringify(digest.title ?? '')}`,
    `type: ${JSON.stringify(digest.noteType)}`,
    `tags: [${digest.tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
    `preview: ${JSON.stringify(digest.preview ?? '')}`,
    '---',
  ];

  return `${header.join('\n')}\n\n${digest.content ?? ''}\n`;
}

export function digestFileName(weekStart: string): string {
  return `dev-diary-${weekStart}.md`;
}

// Links to GitHub are what a digest is made of: they are not a leak, so the advisory scan does not flag them.
export function isIgnoredLeak(match: string): boolean {
  return /(^|\.)github(usercontent)?\.com$/i.test(match);
}
