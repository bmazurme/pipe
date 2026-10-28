const DAY_MS = 24 * 60 * 60 * 1000;

/** Warn this many days before the secret expires. */
export const SECRET_WARN_DAYS = 14;

export type SecretExpiryBadge = { theme: 'warning' | 'danger'; text: string };

/** Badge for a secret's expiry day (YYYY-MM-DD); null when there is none or it is far off. */
export function describeSecretExpiry(expiresOn: string | null | undefined, now: Date = new Date()): SecretExpiryBadge | null {
  if (!expiresOn) return null;

  const [year, month, day] = expiresOn.slice(0, 10).split('-').map(Number);

  if (!year || !month || !day) return null;

  // Calendar days, compared at UTC midnight so DST shifts cannot move the count.
  const expiry = Date.UTC(year, month - 1, day);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((expiry - today) / DAY_MS);

  if (days < 0) return { theme: 'danger', text: 'истёк' };
  if (days <= SECRET_WARN_DAYS) return { theme: 'warning', text: `истекает через ${days} дн.` };

  return null;
}
