import { describe, expect, it } from 'vitest';

import type { ClaudeCredential, WorkerJob } from '../../store/api';
import { alternativeToken, diagnoseFailure } from './failureDiagnosis';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const inFuture = (hours: number) => Math.floor(NOW / 1000) + hours * 3600;

const job = (over: Partial<WorkerJob>): WorkerJob =>
  ({ id: 5, status: 'failed', model: 'sonnet', claudeCredentialId: 1, usedClaudeCredentialName: 'main', errorMessage: null, ...over }) as WorkerJob;

const token = (id: number, name: string, over: Partial<ClaudeCredential> = {}): ClaudeCredential => ({
  id,
  name,
  createdAt: '2026-10-01T00:00:00Z',
  limits: null,
  authFailedAt: null,
  authFailedJobId: null,
  ...over,
});

const limits = (utilization: number, hours = 3) =>
  ({ status: 'allowed', rateLimitType: 'five_hour', isUsingOverage: false, windows: { five_hour: { utilization, resetsAt: inFuture(hours) } }, reportedAt: '2026-10-30T11:00:00Z' }) as ClaudeCredential['limits'];

describe('diagnoseFailure', () => {
  it('says nothing about a job that did not fail, has no error, or fails for an unknown reason', () => {
    expect(diagnoseFailure(job({ status: 'succeeded', errorMessage: 'claude timed out after 600s' }), [], NOW)).toBeNull();
    expect(diagnoseFailure(job({ errorMessage: null }), [], NOW)).toBeNull();
    expect(diagnoseFailure(job({ errorMessage: 'Model run exited with code 1: segfault' }), [], NOW)).toBeNull();
  });

  it('offers a doubled limit after a timeout, in whole 5-minute steps, capped at 4 hours', () => {
    const two = diagnoseFailure(job({ errorMessage: 'claude timed out after 1800s and was killed' }), [], NOW);
    const odd = diagnoseFailure(job({ errorMessage: 'claude timed out after 700s and was killed' }), [], NOW);
    const big = diagnoseFailure(job({ errorMessage: 'claude timed out after 9000s and was killed' }), [], NOW);

    expect(two).toMatchObject({ cause: 'timeout', actions: [{ label: 'Повторить с лимитом 60 мин', retry: { timeoutSec: 3600 } }] });
    expect(odd?.actions[0].retry?.timeoutSec).toBe(1500);
    expect(big?.actions[0].retry?.timeoutSec).toBe(14_400);
  });

  it('does not offer a longer limit when 4 hours were already not enough', () => {
    const maxed = diagnoseFailure(job({ errorMessage: 'claude timed out after 14400s and was killed' }), [], NOW);

    expect(maxed?.actions).toEqual([]);
    expect(maxed?.hint).toContain('разбейте');
  });

  it('on a revoked token offers another healthy token first, then the keys page', () => {
    const diagnosis = diagnoseFailure(
      job({ errorMessage: 'Model run exited with code 1: Failed to authenticate: OAuth token revoked. Please log in again' }),
      [token(1, 'main'), token(2, 'spare')],
      NOW,
    );

    expect(diagnosis?.cause).toBe('token_revoked');
    expect(diagnosis?.hint).toContain('«main»');
    expect(diagnosis?.actions).toEqual([
      { id: 'other-token', label: 'Повторить на токене «spare»', retry: { claudeCredentialId: 2 } },
      { id: 'keys', label: 'Открыть токены', to: '/worker?tab=keys' },
    ]);
  });

  it('skips tokens that are logged out or nearly full, and prefers the emptiest', () => {
    const credentials = [
      token(1, 'main'),
      token(2, 'logged-out', { authFailedAt: '2026-10-30T00:00:00Z' }),
      token(3, 'full', { limits: limits(0.97) }),
      token(4, 'busy', { limits: limits(0.6) }),
      token(5, 'quiet', { limits: limits(0.1) }),
      token(6, 'reset', { limits: { ...limits(0.99), windows: { five_hour: { utilization: 0.99, resetsAt: inFuture(-1) } } } as ClaudeCredential['limits'] }),
    ];

    expect(alternativeToken(job({}), credentials, NOW)?.name).toBe('reset');
    expect(alternativeToken(job({}), credentials.filter((item) => item.name !== 'reset'), NOW)?.name).toBe('quiet');
    expect(alternativeToken(job({}), [token(1, 'main')], NOW)).toBeNull();
  });

  it('on a session limit offers to wait for the reset when it is known, and another token', () => {
    const credentials = [token(1, 'main', { limits: limits(1, 2) }), token(2, 'spare')];
    const diagnosis = diagnoseFailure(job({ errorMessage: "Model run exited with code 1: You've hit your session limit · resets 3:00pm" }), credentials, NOW);

    expect(diagnosis?.cause).toBe('session_limit');
    expect(diagnosis?.actions.map((action) => action.id)).toEqual(['after-reset', 'other-token']);
    expect(diagnosis?.actions[0].retry?.notBefore).toBeTruthy();
  });

  it('on a session limit with no known reset still offers another token', () => {
    const diagnosis = diagnoseFailure(job({ errorMessage: "You've hit your session limit" }), [token(1, 'main'), token(2, 'spare')], NOW);

    expect(diagnosis?.actions.map((action) => action.id)).toEqual(['other-token']);
  });

  it('points a "Request not allowed" at the VPN rather than the token', () => {
    const diagnosis = diagnoseFailure(job({ errorMessage: 'Model run exited with code 1: Failed to authenticate. API Error: 403 Request not allowed' }), [], NOW);

    expect(diagnosis?.cause).toBe('auth_denied');
    expect(diagnosis?.actions).toEqual([{ id: 'vpn', label: 'Проверить VPN', to: '/vpn' }]);
  });

  it('recognises the add-in being down and a lost worker, both just worth repeating', () => {
    const fusion = diagnoseFailure(job({ errorMessage: 'Cannot reach the pipe add-in at http://127.0.0.1:1 (timeout) — is Fusion 360 running with the add-in started?' }), [], NOW);
    const lost = diagnoseFailure(job({ errorMessage: 'Worker was restarted or lost while this job was running — the run did not finish' }), [], NOW);

    expect(fusion).toMatchObject({ cause: 'fusion_unreachable', actions: [{ retry: {} }] });
    expect(lost).toMatchObject({ cause: 'worker_lost', actions: [{ retry: {} }] });
  });
});
