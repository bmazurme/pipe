import type { ClaudeCredential, WorkerJob } from '../../store/api';
import { isSessionLimitFailure, limitResetAt } from './claudeLimits';

// Why a run failed, in words, and what to press next. The worker's error text is the only evidence, so this recognises the failures that
// actually recur (see Worker → «Ошибки за 7 дн.») and says nothing about the rest: a wrong guess is worse than no hint.

export type FailureCause = 'timeout' | 'token_revoked' | 'session_limit' | 'auth_denied' | 'fusion_unreachable' | 'worker_lost';

export interface DiagnosisAction {
  id: string;
  label: string;
  /** Run the job again with these changes. */
  retry?: { notBefore?: string; claudeCredentialId?: number; timeoutSec?: number };
  /** Or go to the page where the cause is fixed. */
  to?: string;
}

export interface Diagnosis {
  cause: FailureCause;
  title: string;
  hint: string;
  actions: DiagnosisAction[];
}

const MIN_TIMEOUT_SEC = 300;
const MAX_TIMEOUT_SEC = 14_400;
const STEP_SEC = 300;
// A token this full is not an alternative.
const FULL = 0.95;

const TIMED_OUT = /timed out after (\d+)\s*s/i;
const TOKEN_REVOKED = /token (?:has been )?revoked|oauth token.*(?:expired|invalid)|invalid (?:api key|x-api-key)|please (?:log|sign) in again/i;
const AUTH_DENIED = /failed to authenticate|request not allowed|api error: 40[13]/i;
const FUSION = /cannot reach the pipe add-in/i;
const WORKER_LOST = /worker was (?:stopped|restarted or lost)/i;

const minutes = (seconds: number) => `${Math.round(seconds / 60)} мин`;

/** The highest still-live share of a plan window of this token's last snapshot (0 when unknown). */
function usedShare(credential: ClaudeCredential, now: number): number {
  const windows = Object.values(credential.limits?.windows ?? {}).filter((window) => window.resetsAt === null || window.resetsAt * 1000 > now);

  return windows.length ? Math.max(...windows.map((window) => window.utilization)) : 0;
}

/** Another stored token that looks usable: not the one that failed, not logged out, not full. The emptiest first. */
export function alternativeToken(job: Pick<WorkerJob, 'claudeCredentialId' | 'usedClaudeCredentialName'>, credentials: ClaudeCredential[], now: number): ClaudeCredential | null {
  return (
    credentials
      .filter((item) => item.id !== job.claudeCredentialId && item.name !== job.usedClaudeCredentialName)
      .filter((item) => !item.authFailedAt && usedShare(item, now) < FULL)
      .sort((a, b) => usedShare(a, now) - usedShare(b, now))[0] ?? null
  );
}

export function diagnoseFailure(job: WorkerJob, credentials: ClaudeCredential[], now: number): Diagnosis | null {
  const message = job.errorMessage;

  if (job.status !== 'failed' || !message) return null;

  const other = alternativeToken(job, credentials, now);
  const onOther: DiagnosisAction[] = other ? [{ id: 'other-token', label: `Повторить на токене «${other.name}»`, retry: { claudeCredentialId: other.id } }] : [];
  const tokenName = job.usedClaudeCredentialName ? `«${job.usedClaudeCredentialName}»` : 'Токен задачи';

  // Order matters: a revoked token also says "failed to authenticate".
  if (TOKEN_REVOKED.test(message)) {
    return {
      cause: 'token_revoked',
      title: 'Токен Claude отозван',
      hint: `${tokenName} больше не принимается. Войдите заново (claude setup-token) и обновите токен на вкладке «Ключи и подключения»; пока можно пустить задачу на другом токене.`,
      actions: [...onOther, { id: 'keys', label: 'Открыть токены', to: '/worker?tab=keys' }],
    };
  }

  if (isSessionLimitFailure(message)) {
    const credential = credentials.find((item) => item.id === job.claudeCredentialId || item.name === job.usedClaudeCredentialName);
    const resetAt = limitResetAt(message, credential?.limits, now);

    return {
      cause: 'session_limit',
      title: 'Исчерпан лимит Claude',
      hint: resetAt
        ? 'Лимит окна кончился. Задачу можно поставить на время сразу после сброса или пустить на другом токене.'
        : 'Лимит окна кончился, время сброса неизвестно. Можно пустить задачу на другом токене.',
      actions: [...(resetAt ? [{ id: 'after-reset', label: 'Повторить после сброса лимита', retry: { notBefore: resetAt } }] : []), ...onOther],
    };
  }

  const timedOut = TIMED_OUT.exec(message);

  if (timedOut) {
    const used = Number(timedOut[1]);

    if (used >= MAX_TIMEOUT_SEC) {
      return {
        cause: 'timeout',
        title: 'Время вышло, а лимит уже предельный',
        hint: `Задача не уложилась даже в ${minutes(used)} — больше 4 часов поставить нельзя. Скорее всего, задача слишком большая: разбейте её или уточните.`,
        actions: [],
      };
    }

    const next = Math.min(MAX_TIMEOUT_SEC, Math.max(MIN_TIMEOUT_SEC, Math.ceil((used * 2) / STEP_SEC) * STEP_SEC));

    return {
      cause: 'timeout',
      title: 'Не уложилась во время',
      hint: `Запуск остановлен по лимиту ${minutes(used)}. Если задача идёт к концу, помогает больший лимит; если по логу она ходит по кругу, лучше уточнить задачу.`,
      actions: [{ id: 'longer', label: `Повторить с лимитом ${minutes(next)}`, retry: { timeoutSec: next } }],
    };
  }

  if (AUTH_DENIED.test(message)) {
    return {
      cause: 'auth_denied',
      title: 'Провайдер отклонил запрос',
      hint: 'Ответ «Request not allowed» обычно значит, что запрос пришёл из недопустимого региона или с заблокированного адреса. Проверьте VPN воркера; токен при этом может быть исправен.',
      actions: [{ id: 'vpn', label: 'Проверить VPN', to: '/vpn' }, ...onOther],
    };
  }

  if (FUSION.test(message)) {
    return {
      cause: 'fusion_unreachable',
      title: 'Fusion 360 на Mac не отвечает',
      hint: 'Add-in PipeFusion не запущен или Fusion закрыт. Откройте Fusion 360, запустите add-in и повторите.',
      actions: [{ id: 'retry', label: 'Повторить', retry: {} }],
    };
  }

  if (WORKER_LOST.test(message)) {
    return {
      cause: 'worker_lost',
      title: 'Воркер перезапускался',
      hint: 'Запуск оборвался из-за воркера, а не из-за задачи. Её можно просто повторить.',
      actions: [{ id: 'retry', label: 'Повторить', retry: {} }],
    };
  }

  return null;
}
