import { In, IsNull, Not } from 'typeorm';
import {
  INFRA_FAILURE_MESSAGES,
  LOST_MESSAGE,
  SHUTDOWN_FAILURE_MESSAGE,
  infraFailureWhere,
  isInfraFailure,
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
});
