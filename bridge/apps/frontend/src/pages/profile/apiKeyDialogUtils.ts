// What the "New API key" dialog suggests and explains. Kept apart from the component so the wording and the date maths are tested.

export interface KeyPreset {
  name: string;
  /** The key is for the boards' agent only. */
  boards: boolean;
}

// The integrations the page itself names; a click fills the name (and the boards-only switch for the agent).
export const KEY_PRESETS: KeyPreset[] = [
  { name: 'sync-cli', boards: false },
  { name: 'reports', boards: false },
  { name: 'worker', boards: false },
  { name: 'ntlstl.time', boards: false },
  { name: 'агент плат', boards: true },
];

export const NAME_MAX = 255;

const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

// The date a key made now with this expiry stops working, in words; 'never' = no date.
export function expiryDate(expiry: string, now: Date = new Date()): string | null {
  const days = Number(expiry);

  return Number.isFinite(days) && days > 0 ? dateFormat.format(new Date(now.getTime() + days * DAY_MS)) : null;
}

export function expiryHint(expiry: string, now: Date = new Date()): string {
  const date = expiryDate(expiry, now);

  return date
    ? `Перестанет работать ${date} — тогда понадобится новый ключ.`
    : 'Работает, пока вы его не отзовёте. Отзывайте ключи, которыми больше не пользуетесь.';
}

export const BOARDS_ONLY_HINT = 'Годится только для агента плат; остальное API для этого ключа закрыто. Безопаснее для устройства, которое вы не контролируете целиком.';

// One line about what was made, shown with the token so it is clear which key it is.
export function describeNewKey(name: string, expiry: string, boardsOnly: boolean, now: Date = new Date()): string {
  const date = expiryDate(expiry, now);

  return [name, date ? `до ${date}` : 'бессрочно', boardsOnly ? 'только для плат' : 'полный доступ'].join(' · ');
}

export function usageExample(apiUrl: string, token: string): string {
  return `curl -H "X-Api-Key: ${token}" ${apiUrl}/api/v1/worker/status`;
}
