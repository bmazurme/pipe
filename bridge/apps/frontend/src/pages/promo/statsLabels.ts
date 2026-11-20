// Names for what the landing's counter reports, as the owner reads them.

const TARGETS: Record<string, string> = {
  't.me': 'Telegram',
  'telegram.me': 'Telegram',
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'instagram.com': 'Instagram',
  'github.com': 'GitHub',
};

export function targetLabel(host: string | null): string {
  if (!host) return 'без адреса';

  return TARGETS[host] ? `${TARGETS[host]} (${host})` : host;
}

// A visit with no referrer: typed in, a bookmark, or a messenger that hides where the link came from.
export function sourceLabel(host: string | null): string {
  return host ?? 'прямой заход / источник скрыт';
}

const SECTIONS: Record<string, string> = {
  top: 'первый экран',
  water: 'видео с воды',
  righting: 'самопереворот',
  data: 'данные испытаний',
  build: 'что нужно для сборки',
  case: 'кейс',
  package: 'комплект',
  faq: 'вопросы',
  join: 'призыв подписаться',
  footer: 'подвал',
};

export function sectionLabel(id: string | null): string {
  if (!id) return 'вне секции';

  return SECTIONS[id] ?? id;
}

const LANGS: Record<string, string> = { ru: 'русский', en: 'English' };

export function langLabel(lang: string | null): string {
  return lang ? (LANGS[lang] ?? lang) : 'не определён';
}

const DEVICES: Record<string, string> = { mobile: 'телефон', tablet: 'планшет', desktop: 'компьютер' };

export function deviceLabel(device: string | null): string {
  return device ? (DEVICES[device] ?? device) : '—';
}

// «utm_source / utm_medium / utm_campaign» as one line, skipping what is not set.
export function campaignLabel(source: string | null, medium: string | null, campaign: string | null): string {
  return [source, medium, campaign].filter(Boolean).join(' / ') || '—';
}

// «20 нояб.» for a YYYY-MM-DD day (noon, so no time zone moves it to the next day).
export function shortDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

// The share of `value` in `total`, as a whole percent; 0 when there is nothing to share.
export function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}
