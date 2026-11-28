// Credentials recognised by their *shape* — a provider prefix, a PEM header, a JWT, userinfo in a URL.
// Unlike leakScan.ts (a broad advisory heuristic with many false positives: hostnames, emails, long
// identifiers), every pattern here is specific enough to warn on or to mask without getting in the way
// of an ordinary conversation. Used where text is about to be stored or sent somewhere it should not
// carry a secret: bridge's chat composer (a warning before sending) and mirrored, with bridge's own
// key prefixes, by the backend's redaction of stored chat messages.

export interface CredentialPattern {
  /** Short name shown to the person, e.g. "ключ Anthropic". */
  label: string;
  pattern: RegExp;
}

export const CREDENTIAL_PATTERNS: CredentialPattern[] = [
  { label: 'ключ Anthropic / OpenAI', pattern: /\b(?:sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{16,})\b/g },
  { label: 'токен GitHub', pattern: /\b(?:ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]{16,}\b/g },
  { label: 'токен GitLab', pattern: /\bglpat-[A-Za-z0-9_-]{16,}\b/g },
  { label: 'токен Telegram-бота', pattern: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g },
  { label: 'ключ bridge', pattern: /\b(?:brk_|brw_|brn_|bre_)[A-Za-z0-9_-]{16,}\b/g },
  { label: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { label: 'заголовок Bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
  { label: 'приватный ключ', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { label: 'пароль в адресе', pattern: /\b[a-z][a-z0-9+.-]{0,20}:\/\/[^\s/@:]{1,100}:[^\s/@]{3,200}@/gi },
];

export interface CredentialFinding {
  label: string;
  /** Start of the value, then `***` — never the whole secret, so a finding is safe to show. */
  preview: string;
}

const preview = (value: string): string => `${value.slice(0, 4)}***`;

/** Every credential-shaped value in `text`, each reported once. */
export function findCredentials(text: string): CredentialFinding[] {
  const found: CredentialFinding[] = [];
  const seen = new Set<string>();

  for (const { label, pattern } of CREDENTIAL_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (seen.has(match[0])) continue;
      seen.add(match[0]);
      found.push({ label, preview: preview(match[0]) });
    }
  }

  return found;
}

/** `text` with every credential-shaped value replaced by `[скрыто: <label>]`. */
export function maskCredentials(text: string): string {
  return CREDENTIAL_PATTERNS.reduce((value, { label, pattern }) => value.replace(pattern, `[скрыто: ${label}]`), text);
}

export interface CredentialHit extends CredentialFinding {
  source: string;
  line: number;
}

/** Credentials in several named texts (files, an issue's title, …), each with where it is. */
export function scanForCredentials(targets: Array<{ source: string; content: string }>): CredentialHit[] {
  const hits: CredentialHit[] = [];

  for (const { source, content } of targets) {
    const seen = new Set<string>();

    for (const { label, pattern } of CREDENTIAL_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        if (seen.has(match[0])) continue;
        seen.add(match[0]);

        // matchAll always sets index.
        const line = content.slice(0, match.index as number).split('\n').length;

        hits.push({ source, line, label, preview: preview(match[0]) });
      }
    }
  }

  return hits;
}
