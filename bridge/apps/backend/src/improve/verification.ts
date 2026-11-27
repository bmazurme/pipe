// A3 — the gate before a pull request, bridge side. The worker runs `scripts/verify-changed.mjs` on the result before it leaves and writes the
// verdict into the result parcel (`.pipe-verify.json`, worker/src/verification.ts); this decides what to do with it. Pure.
//
//   passed / unverified / no verdict   → open the pull request (CI is still the judge; an unverified one is said so in the description)
//   failed, first time                 → ONE more go at it by the worker, with the check's output, BEFORE a pull request exists
//   failed, again                      → no pull request: the owner is told, and can still publish the result as it is
//
// The old way — open it, let CI go red, repair it — stays as the fallback (improve-ci.service.ts); this is what makes the first red CI rarer.

export type VerificationStatus = 'passed' | 'failed' | 'unverified';

export interface Verification {
  status: VerificationStatus;
  summary: string;
  output: string;
  durationSec: number;
  notVerified: string[];
}

export const VERIFY_ENTRY = '.pipe-verify.json';
// One automatic go before the pull request; a model that cannot fix it in two attempts is not helped by a third.
export const MAX_GATE_RETRIES = 1;
const MAX_OUTPUT_CHARS = 8000;

const STATUSES = new Set<VerificationStatus>([
  'passed',
  'failed',
  'unverified',
]);

// What a worker wrote — an untrusted file (a model had its hands on that folder): only the expected shape is kept, and bounded.
export function parseVerification(text: string): Verification | null {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  if (!raw || typeof raw !== 'object') return null;

  const value = raw as Record<string, unknown>;

  if (
    typeof value.status !== 'string' ||
    !STATUSES.has(value.status as VerificationStatus)
  )
    return null;

  const str = (field: unknown, max: number) =>
    typeof field === 'string' ? field.slice(0, max) : '';

  return {
    status: value.status as VerificationStatus,
    summary: str(value.summary, 500),
    // The end is what matters, so when it is too long the beginning goes.
    output:
      typeof value.output === 'string'
        ? value.output.slice(-MAX_OUTPUT_CHARS)
        : '',
    durationSec:
      typeof value.durationSec === 'number' &&
      Number.isFinite(value.durationSec)
        ? Math.max(0, Math.round(value.durationSec))
        : 0,
    notVerified: Array.isArray(value.notVerified)
      ? value.notVerified
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 20)
          .map((item) => item.slice(0, 200))
      : [],
  };
}

export type GateDecision =
  { action: 'open' } | { action: 'retry' } | { action: 'fail'; reason: string };

export function gateDecision(
  verification: Verification | null,
  retriesDone: number,
  options: { skipGate?: boolean } = {},
): GateDecision {
  if (!verification || verification.status !== 'failed' || options.skipGate)
    return { action: 'open' };

  if (retriesDone < MAX_GATE_RETRIES) return { action: 'retry' };

  return {
    action: 'fail',
    reason: `Проверка перед PR не прошла даже после исправления: ${verification.summary}`,
  };
}

// What the worker is told on the second go: the task as it was, then what its own result got wrong. The changes are already in the repository
// it is given, so it fixes them instead of starting over.
export function retryTask(
  originalBody: string,
  verification: Verification,
): string {
  return [
    originalBody.trimEnd(),
    '',
    '## Your previous attempt failed its check — fix it',
    '',
    'The repository you were given ALREADY CONTAINS your previous changes. After they were made, `node scripts/verify-changed.mjs` was run on them and failed. Fix what it reports — do not start over and do not undo the work; keep the change as small as the fix needs. Then run `node scripts/verify-changed.mjs` again and fix what it still reports, as above.',
    '',
    'What the check printed (the end of its output):',
    '```',
    verification.output.trim() || verification.summary,
    '```',
  ].join('\n');
}

// A section of the pull request's description. Only a failed check shows its output — a passed one says what was not verified.
export function describeForPr(
  verification: Verification | null,
  retried: boolean,
): string | null {
  if (!verification) return null;

  const retriedText = retried
    ? ' (после одного автоматического исправления)'
    : '';

  if (verification.status === 'passed') {
    return [
      `**Проверка перед PR${retriedText}:** пройдена (\`node scripts/verify-changed.mjs\` в песочнице worker, ${verification.durationSec} с).`,
      ...(verification.notVerified.length > 0
        ? [`Не проверено: ${verification.notVerified.join('; ')}.`]
        : []),
    ].join('\n');
  }

  if (verification.status === 'unverified') {
    return `**Проверка перед PR:** не выполнена — ${verification.summary}. Судья — CI.`;
  }

  return [
    `**Проверка перед PR${retriedText}:** НЕ пройдена — ${verification.summary}. PR открыт по вашему решению; CI покажет то же.`,
    '',
    '<details><summary>Вывод проверки</summary>',
    '',
    '```',
    verification.output.trim(),
    '```',
    '',
    '</details>',
  ].join('\n');
}
