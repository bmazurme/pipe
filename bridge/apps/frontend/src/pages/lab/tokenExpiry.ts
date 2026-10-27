const DAY_MS = 24 * 60 * 60 * 1000;

/** Warn this many days before the token expires. */
export const TOKEN_WARN_DAYS = 7;

export type TokenExpiry = { text: string; label: { theme: 'warning' | 'danger'; text: string } | null };

/** What to show about a token's expiry; null for a token without one. */
export function describeTokenExpiry(expiresAt: string | null, now: Date = new Date()): TokenExpiry | null {
  if (!expiresAt) return null;

  const date = new Date(expiresAt);

  if (Number.isNaN(date.getTime())) return null;

  const text = `токен до ${date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
  const left = date.getTime() - now.getTime();

  if (left <= 0) return { text, label: { theme: 'danger', text: 'токен истёк' } };

  const days = Math.ceil(left / DAY_MS);

  if (days <= TOKEN_WARN_DAYS) return { text, label: { theme: 'warning', text: `истекает через ${days} дн.` } };

  return { text, label: null };
}
