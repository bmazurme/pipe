// Anonymization completeness check: a heuristic scan run over content *after*
// dictionary substitution (toRemote), looking for values that still look like
// real secrets/hosts/emails and so probably weren't covered by the active
// dictionary. This is deliberately advisory, not a gate: regex+entropy
// heuristics on arbitrary source text will always have false positives (a
// long camelCase identifier, a public domain, a git hash) and false
// negatives (a short secret, a name with no email/host shape). Treat a
// finding as "double-check this before it leaves the machine", not as proof
// of a leak.

export type LeakKind = 'email' | 'ip' | 'hostname' | 'token' | 'secret';

export interface LeakFinding {
  source: string;
  line: number;
  kind: LeakKind;
  match: string;
}

export interface LeakScanTarget {
  source: string;
  content: string;
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
// Boilerplate that shows up constantly in configs and isn't a real leak.
const IGNORED_IPV4 = new Set(['0.0.0.0', '127.0.0.1', '255.255.255.255']);

// Domain-shaped tokens: 2+ dot-separated labels ending in something
// TLD-like. This also matches every relative import/filename in source code
// ("utils.ts", "styles.module.css"), so the two lists below exist
// specifically to suppress that noise.
const HOSTNAME_RE = /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,24}\b/g;

const CODE_FILE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'json', 'md', 'mdx',
  'css', 'scss', 'sass', 'less', 'html', 'htm', 'yml', 'yaml', 'txt',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'lock', 'env',
  'sh', 'bash', 'py', 'go', 'java', 'rb', 'php', 'xml', 'toml', 'ini',
  'log', 'sql', 'csv', 'pdf', 'zip', 'map', 'woff', 'woff2', 'ttf',
  'eot', 'test', 'spec', 'config', 'lockb', 'gitignore', 'd',
]);

// Public/well-known domains that legitimately show up in source (docs
// links, CDN URLs, package registries) — a suffix match, so
// "docs.github.com" is suppressed by "github.com" too.
const KNOWN_PUBLIC_HOSTS = [
  'github.com', 'githubusercontent.com', 'npmjs.com', 'npmjs.org',
  'nodejs.org', 'typescriptlang.org', 'w3.org', 'schema.org',
  'google.com', 'googleapis.com', 'gstatic.com', 'gitlab.com',
  'stackoverflow.com', 'mozilla.org', 'wikipedia.org', 'example.com',
  'example.org', 'localhost', 'unpkg.com', 'jsdelivr.net',
  'cdnjs.cloudflare.com', 'yarnpkg.com', 'vuejs.org', 'reactjs.org',
];

function isKnownPublicHost(host: string): boolean {
  const lower = host.toLowerCase();
  return KNOWN_PUBLIC_HOSTS.some((known) => lower === known || lower.endsWith(`.${known}`));
}

// Real hostnames are conventionally all-lowercase; a capitalized label
// ("Hooks.resolve", "Object.assign", "Array.prototype") is a method/property
// access in code or a stack trace, not a domain — this is the single most
// common false-positive shape for HOSTNAME_RE once file-extension noise is
// already filtered out.
function looksLikeCodeIdentifier(value: string): boolean {
  return value.split('.').some((label) => /^[A-Z]/.test(label));
}

// Long runs of base64/hex-ish characters with no separators — the shape of
// an API key, access token, or content hash. Length 24 and a required digit
// keep this from tripping over ordinary long camelCase identifiers, which
// tend to be all-letters and shorter than real tokens.
const TOKEN_RE = /[A-Za-z0-9+/_=-]{24,}/g;
const TOKEN_ENTROPY_THRESHOLD = 4.0;

// `<key containing a secret word> = / : <value>`. The key part is bounded so
// scanning stays linear on long runs of word characters. The finding reports
// only the key and a masked value, never the secret itself.
const SECRET_ASSIGNMENT_RE =
  /([\w.-]{0,40}(?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key)[\w-]{0,20})["']?[ \t]*[=:][ \t]*["']?([^\s"'`,;]{4,})/gi;

// scheme://user:password@host — the password is anything up to '@'.
const URL_CREDENTIALS_RE = /\b[a-z][a-z0-9+.-]{0,20}:\/\/([^\s:@/]{1,100}):([^\s@/]{1,200})@[^\s/]{1,255}/gi;

const NON_SECRET_VALUES = new Set(['string', 'number', 'boolean', 'undefined', 'null', 'true', 'false', 'none']);

function isPlaceholderValue(value: string): boolean {
  const lower = value.toLowerCase();
  if (value.startsWith('${') || value.startsWith('$(') || value.startsWith('{{') || value.startsWith('[[')) return true;
  if (value.startsWith('<') || value.startsWith('%(')) return true;
  if (lower.startsWith('process.env') || lower.startsWith('os.environ') || lower.startsWith('env.')) return true;
  if (lower === 'changeme' || NON_SECRET_VALUES.has(lower)) return true;
  return /^x{3,}$/i.test(value) || /^\*{3,}$/.test(value);
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);

  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Offsets of every newline, computed once per target; a line number is then
// 1 + the count of newlines strictly before the index (binary search).
function newlineOffsets(content: string): number[] {
  const offsets: number[] = [];
  for (let i = content.indexOf('\n'); i !== -1; i = content.indexOf('\n', i + 1)) offsets.push(i);
  return offsets;
}

function lineAt(newlines: number[], index: number): number {
  let lo = 0;
  let hi = newlines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (newlines[mid] < index) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

function scanOne({ source, content }: LeakScanTarget): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const newlines = newlineOffsets(content);
  const emailSpans: Array<[number, number]> = [];
  const urlSpans: Array<[number, number]> = [];

  for (const match of content.matchAll(URL_CREDENTIALS_RE)) {
    if (isPlaceholderValue(match[2])) continue;
    const index = match.index ?? 0;
    urlSpans.push([index, index + match[0].length]);
    findings.push({ source, line: lineAt(newlines, index), kind: 'secret', match: `${match[1]}:${match[2][0]}***@…` });
  }

  for (const match of content.matchAll(SECRET_ASSIGNMENT_RE)) {
    if (isPlaceholderValue(match[2])) continue;
    findings.push({
      source,
      line: lineAt(newlines, match.index ?? 0),
      kind: 'secret',
      match: `${match[1]}=${match[2][0]}***`,
    });
  }

  for (const match of content.matchAll(EMAIL_RE)) {
    const index = match.index ?? 0;
    if (urlSpans.some(([from, to]) => index >= from && index < to)) continue;
    emailSpans.push([index, index + match[0].length]);
    findings.push({ source, line: lineAt(newlines, index), kind: 'email', match: match[0] });
  }

  for (const match of content.matchAll(IPV4_RE)) {
    if (IGNORED_IPV4.has(match[0])) continue;
    findings.push({ source, line: lineAt(newlines, match.index ?? 0), kind: 'ip', match: match[0] });
  }

  // Hostname matches arrive in index order, so a single advancing pointer
  // into the (sorted) email + URL-credential spans is enough.
  emailSpans.push(...urlSpans);
  emailSpans.sort((a, b) => a[0] - b[0]);
  let spanIdx = 0;
  for (const match of content.matchAll(HOSTNAME_RE)) {
    const index = match.index ?? 0;
    while (spanIdx < emailSpans.length && emailSpans[spanIdx][1] <= index) spanIdx++;
    if (spanIdx < emailSpans.length && emailSpans[spanIdx][0] <= index) continue;
    const value = match[0];
    const tld = value.slice(value.lastIndexOf('.') + 1).toLowerCase();
    if (CODE_FILE_EXTENSIONS.has(tld)) continue;
    if (isKnownPublicHost(value)) continue;
    if (looksLikeCodeIdentifier(value)) continue;
    findings.push({ source, line: lineAt(newlines, index), kind: 'hostname', match: value });
  }

  for (const match of content.matchAll(TOKEN_RE)) {
    const value = match[0];
    if (!/\d/.test(value)) continue;
    if (shannonEntropy(value) < TOKEN_ENTROPY_THRESHOLD) continue;
    findings.push({ source, line: lineAt(newlines, match.index ?? 0), kind: 'token', match: value });
  }

  return findings;
}

export function scanForLeaks(targets: LeakScanTarget[]): LeakFinding[] {
  return targets.flatMap(scanOne);
}

// Ready-to-print summary shared by every consumer (sync, reports) so the
// wording and the "this is a heuristic" caveat only live in one place.
export function formatLeakFindings(findings: LeakFinding[], limit = 20): string {
  if (findings.length === 0) return '';

  const lines = findings.slice(0, limit).map((f) => `  ${f.source}:${f.line} — possible ${f.kind}: ${f.match}`);
  const more = findings.length > limit ? `\n  … and ${findings.length - limit} more` : '';

  return (
    `Warning: found ${findings.length} value(s) that still look real after dictionary substitution ` +
    `(heuristic check — may include false positives, and can't catch everything; review before this leaves the machine):\n` +
    `${lines.join('\n')}${more}`
  );
}
