// What the "New API key" dialog suggests and explains. Kept apart from the component so the wording and the date maths are tested.

import type { ApiKeyScope } from '../../store/api';

export interface KeyPreset {
  name: string;
  /** What the key is limited to; absent = a full key. */
  scope?: ApiKeyScope;
}

// The integrations the page itself names; a click fills the name and the scope that integration needs.
export const KEY_PRESETS: KeyPreset[] = [
  { name: 'sync-cli' },
  { name: 'reports', scope: 'reports-sync' },
  { name: 'worker' },
  { name: 'ntlstl.time' },
  { name: 'агент плат', scope: 'boards' },
];

export const NAME_MAX = 255;

// A key lives 90 days unless the owner says otherwise; «never» is a choice, not the default.
export const DEFAULT_EXPIRY = '90';

export const SCOPE_OPTIONS: Array<{ value: string; content: string }> = [
  { value: 'full', content: 'Полный доступ' },
  { value: 'readonly', content: 'Только чтение' },
  { value: 'reports-sync', content: 'reports (sync)' },
  { value: 'boards', content: 'Только плат' },
];

export const SCOPE_HINTS: Record<string, string> = {
  full: 'Всё, что доступно ключам: sync-cli, worker, свои скрипты. Если ключ утечёт, им можно и читать, и менять.',
  readonly: 'Только запросы на чтение. Менять и удалять нельзя; посылку из Storage забрать тоже нельзя (скачивание её удаляет), а секреты worker не выдаются.',
  'reports-sync': 'Ровно то, что вызывает сервер reports: Storage (посылки), импорт и экспорт времени, настройки и релиз reports, пульс клиента, задачи worker. Остальное API закрыто.',
  boards: 'Годится только для агента плат; остальное API для этого ключа закрыто. Безопаснее для устройства, которое вы не контролируете целиком.',
};

export const scopeOf = (value: string): ApiKeyScope | undefined => (value === 'full' ? undefined : (value as ApiKeyScope));

export const SCOPE_NAME: Record<ApiKeyScope, string> = {
  boards: 'только для плат',
  readonly: 'только чтение',
  'reports-sync': 'для reports (sync)',
};

export const describeScope = (scope: ApiKeyScope | null | undefined): string => (scope ? SCOPE_NAME[scope] : 'полный доступ');

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
    ? `Перестанет работать ${date} — за неделю до этого придёт напоминание в Telegram, а «Перевыпустить» заменит ключ одним нажатием.`
    : 'Бессрочный ключ — осознанный выбор: он работает, пока вы его не отзовёте, и такой ключ, забытый на старом ноутбуке, остаётся дырой навсегда. Если можно, выберите срок.';
}

// One line about what was made, shown with the token so it is clear which key it is.
export function describeNewKey(name: string, expiry: string, scope: ApiKeyScope | undefined, now: Date = new Date()): string {
  const date = expiryDate(expiry, now);

  return [name, date ? `до ${date}` : 'бессрочно', describeScope(scope)].join(' · ');
}

// «unused for N days», only once it is long enough to be worth a word (the same 30 days the Telegram reminder uses).
export const STALE_AFTER_DAYS = 30;

export function idleDays(lastUsedAt: string | null, createdAt: string, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(lastUsedAt ?? createdAt).getTime()) / DAY_MS);
}

export function usageExample(apiUrl: string, token: string): string {
  return `curl -H "X-Api-Key: ${token}" ${apiUrl}/api/v1/worker/status`;
}
