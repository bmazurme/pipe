// Values shorter than this are not treated as secrets: masking "test" would mangle ordinary text.
export const MIN_SECRET_LENGTH = 12;

export const REDACTED = '[redacted]';

export function usableSecrets(secrets: (string | null | undefined)[]): string[] {
  return [...new Set(secrets.filter((s): s is string => typeof s === 'string' && s.length >= MIN_SECRET_LENGTH))];
}

export function maxSecretLength(secrets: (string | null | undefined)[]): number {
  return usableSecrets(secrets).reduce((max, s) => Math.max(max, s.length), 0);
}

// Plain split/join — no regex is ever built from a secret.
export function makeRedactor(secrets: (string | null | undefined)[]): (text: string) => string {
  const list = usableSecrets(secrets).sort((a, b) => b.length - a.length);
  if (list.length === 0) return (text) => text;
  return (text) => list.reduce((acc, secret) => (acc.includes(secret) ? acc.split(secret).join(REDACTED) : acc), text);
}
