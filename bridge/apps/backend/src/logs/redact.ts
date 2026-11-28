// Everything written to app_logs passes through here first. Log text can come
// from model output, upstream error bodies and exception messages — all of which
// have been seen to echo credentials back. Better to lose a few characters of
// diagnostic text than to store a token.

import { API_KEY_PREFIX } from '../auth/api-keys.service';
import { EMERGENCY_KEY_PREFIX } from '../auth/emergency-keys.service';
import {
  ENROLL_CODE_PREFIX,
  WORKER_KEY_PREFIX,
} from '../auth/worker-keys.service';

const BRIDGE_KEY_PREFIXES = [
  API_KEY_PREFIX,
  WORKER_KEY_PREFIX,
  ENROLL_CODE_PREFIX,
  EMERGENCY_KEY_PREFIX,
];

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
  // Bridge's own credentials: brk_/brw_/brn_/bre_ keys and bare JWTs.
  [
    new RegExp(
      `\\b(?:${BRIDGE_KEY_PREFIXES.join('|')})[A-Za-z0-9_-]{16,}\\b`,
      'g',
    ),
    '[redacted-bridge-key]',
  ],
  [
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    '[redacted-jwt]',
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

// What chat messages keep. A chat is prose: "token: refresh" or "password: пароль не подходит" must come
// through untouched, so unlike `redact` above this masks only values that are credentials by their shape
// (a provider prefix, a PEM header, a JWT, userinfo in a URL). The same shapes, with the same labels, are
// what the Chat composer warns about before sending (packages/protocol/src/credentials.ts) — keep the two lists
// in step; bridge's backend does not depend on @pipe/protocol, so this one is written out here.
const CHAT_CREDENTIAL_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(?:sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{16,})\b/g,
    '[скрыто: ключ Anthropic / OpenAI]',
  ],
  [
    /\b(?:ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]{16,}\b/g,
    '[скрыто: токен GitHub]',
  ],
  [/\bglpat-[A-Za-z0-9_-]{16,}\b/g, '[скрыто: токен GitLab]'],
  [/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, '[скрыто: токен Telegram-бота]'],
  [
    new RegExp(
      `\\b(?:${BRIDGE_KEY_PREFIXES.join('|')})[A-Za-z0-9_-]{16,}\\b`,
      'g',
    ),
    '[скрыто: ключ bridge]',
  ],
  [
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    '[скрыто: JWT]',
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g, '[скрыто: заголовок Bearer]'],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    '[скрыто: приватный ключ]',
  ],
  [
    /\b[a-z][a-z0-9+.-]{0,20}:\/\/[^\s/@:]{1,100}:[^\s/@]{3,200}@/gi,
    '[скрыто: пароль в адресе]',
  ],
];

/** Text of a chat message (the user's, the model's) with every credential-shaped value hidden. */
export function redactChatText(text: string): string {
  return CHAT_CREDENTIAL_PATTERNS.reduce(
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
