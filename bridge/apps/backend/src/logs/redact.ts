// Everything written to app_logs passes through here first. Log text can come
// from model output, upstream error bodies and exception messages — all of which
// have been seen to echo credentials back. Better to lose a few characters of
// diagnostic text than to store a token.

const PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]'],
  [/\b(sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{16,})\b/g, '[redacted-key]'],
  [/\b(ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]{16,}\b/g, '[redacted-token]'],
  [/\bglpat-[A-Za-z0-9_-]{16,}\b/g, '[redacted-token]'],
  [/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, '[redacted-bot-token]'],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    '[redacted-private-key]',
  ],
  // key=value / "key":"value" for obviously secret-named fields.
  [
    /((?:password|passwd|secret|token|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"',;&]{4,}/gi,
    '$1[redacted]',
  ],
  // userinfo in URLs: https://user:pass@host
  [/(\w+:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1[redacted]@'],
];

export function redact(text: string): string {
  return PATTERNS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text,
  );
}

const MAX_META_CHARS = 2000;

// Meta is a flat bag of small values; anything else (objects, long strings) is
// stringified and cut — the point is counts and durations, not payloads.
export function sanitizeMeta(
  meta: Record<string, unknown> | undefined,
): string | null {
  if (!meta) return null;

  const clean: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;

    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      clean[key] = value;
    } else {
      clean[key] = redact(String(value)).slice(0, 300);
    }
  }

  const json = JSON.stringify(clean);

  return json === '{}' ? null : json.slice(0, MAX_META_CHARS);
}
