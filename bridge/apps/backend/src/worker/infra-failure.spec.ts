import { In, IsNull, Not } from 'typeorm';
import {
  INFRA_FAILURE_MESSAGES,
  LOST_MESSAGE,
  SHUTDOWN_FAILURE_MESSAGE,
  infraFailureWhere,
  isInfraFailure,
  isRetryableFailure,
  isTransientFailure,
} from './infra-failure';

describe('infra-failure', () => {
  describe('message constants', () => {
    // SHUTDOWN_FAILURE_MESSAGE is duplicated by hand in worker/src/jobRunner.ts:26;
    // old workers send it without failureKind, so both copies must stay identical.
    it('pins the literal legacy messages', () => {
      expect(SHUTDOWN_FAILURE_MESSAGE).toBe(
        'Worker was stopped (SIGTERM) before the job finished — start it again',
      );
      expect(LOST_MESSAGE).toBe(
        'Worker was restarted or lost while this job was running — the run did not finish',
      );
      expect(INFRA_FAILURE_MESSAGES).toEqual([
        SHUTDOWN_FAILURE_MESSAGE,
        LOST_MESSAGE,
      ]);
    });
  });

  describe('isInfraFailure', () => {
    it('is true for any non-empty failureKind', () => {
      expect(
        isInfraFailure({
          failureKind: 'sigterm',
          errorMessage: 'anything',
        } as never),
      ).toBe(true);
      expect(
        isInfraFailure({ failureKind: 'lost', errorMessage: null } as never),
      ).toBe(true);
    });

    it.each([SHUTDOWN_FAILURE_MESSAGE, LOST_MESSAGE])(
      'is true for legacy message without failureKind: %s',
      (errorMessage) => {
        expect(isInfraFailure({ failureKind: null, errorMessage })).toBe(true);
      },
    );

    it('is false for an ordinary error', () => {
      expect(
        isInfraFailure({
          failureKind: null,
          errorMessage: 'claude timed out after 1800s and was killed',
        }),
      ).toBe(false);
    });

    it('is false for a null errorMessage', () => {
      expect(isInfraFailure({ failureKind: null, errorMessage: null })).toBe(
        false,
      );
    });

    it('requires an exact message match', () => {
      expect(
        isInfraFailure({
          failureKind: null,
          errorMessage: `${SHUTDOWN_FAILURE_MESSAGE} (extra)`,
        }),
      ).toBe(false);
    });
  });

  describe('infraFailureWhere', () => {
    it('returns two branches that keep the base keys', () => {
      const base = { userId: 1 };
      const where = infraFailureWhere(base);

      expect(where).toHaveLength(2);
      expect(where[0]).toEqual({ userId: 1, failureKind: Not(IsNull()) });
      expect(where[1]).toEqual({
        userId: 1,
        errorMessage: In(INFRA_FAILURE_MESSAGES),
      });
    });

    it('does not mutate the base object', () => {
      const base = { userId: 1 };
      infraFailureWhere(base);
      expect(base).toEqual({ userId: 1 });
    });
  });

  describe("R4: a provider's bad moment is not the task's fault", () => {
    it.each([
      'Model run exited with code 1: API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}',
      'Model run exited with code 1: API Error: 500 Internal server error',
      'Model run exited with code 1: API Error: 503 Service Unavailable',
      'Model run exited with code 1: API Error: Connection error.',
      'Model run exited with code 1: API Error: Request timed out.',
      'Model run exited with code 1: API Error: ECONNRESET',
      'Model run exited with code 1: ... "type": "overloaded_error" ...',
    ])('is transient: %s', (errorMessage) => {
      expect(isTransientFailure({ errorMessage })).toBe(true);
      expect(isRetryableFailure({ failureKind: null, errorMessage })).toBe(
        true,
      );
    });

    it.each([
      null,
      '',
      'Model run exited with code 1: 2 tests failed',
      // refusals and limits: a retry only spends quota or meets the same refusal
      'Model run exited with code 1: API Error: 403 Request not allowed',
      'Model run exited with code 1: API Error: 401',
      'Model run exited with code 1: Failed to authenticate. API Error: 500',
      'Model run exited with code 1: API Error: 529 Claude usage limit reached',
      'Model run exited with code 1: API Error: 500 rate limit exceeded',
      // not after `API Error:`: the model\'s own output may mention these when the task is about network code
      'Model run exited with code 1: ECONNRESET in the fixture, 3 tests failed',
      'claude timed out after 1800s and was killed',
    ])('is not transient: %s', (errorMessage) => {
      expect(isTransientFailure({ errorMessage })).toBe(false);
      expect(isRetryableFailure({ failureKind: null, errorMessage })).toBe(
        false,
      );
    });

    it('keeps everything that was already infrastructure retryable', () => {
      expect(
        isRetryableFailure({ failureKind: 'lost', errorMessage: null }),
      ).toBe(true);
      expect(
        isRetryableFailure({ failureKind: null, errorMessage: LOST_MESSAGE }),
      ).toBe(true);
    });
  });
});
