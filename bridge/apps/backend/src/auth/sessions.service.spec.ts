import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';

import { Session } from './entities/session.entity';
import { SessionsService } from './sessions.service';

type MockRepository = Partial<Record<keyof Repository<Session>, jest.Mock>>;

function createMockRepository(): MockRepository {
  return {
    findOne: jest.fn(),
    update: jest.fn(),
    find: jest.fn(),
  };
}

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

function baseSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 1,
    userId: 2,
    refreshTokenHash: hash('current-token'),
    previousRefreshTokenHash: null,
    previousRefreshTokenExpiresAt: null,
    userAgent: null,
    ip: null,
    expiresAt: new Date(Date.now() + 60_000),
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Session;
}

describe('SessionsService', () => {
  let service: SessionsService;
  let repository: MockRepository;

  beforeEach(async () => {
    repository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: getRepositoryToken(Session), useValue: repository },
      ],
    }).compile();

    service = module.get(SessionsService);
  });

  describe('validateSession', () => {
    it('validates the current refresh token', async () => {
      repository.findOne!.mockResolvedValue(baseSession());

      const result = await service.validateSession(1, 2, 'current-token');

      expect(result).not.toBeNull();
    });

    it('rejects a token that matches neither the current nor a recent previous hash', async () => {
      repository.findOne!.mockResolvedValue(baseSession());

      const result = await service.validateSession(1, 2, 'wrong-token');

      expect(result).toBeNull();
    });

    // This is the race two concurrent requests hit: the first rotates the
    // token (current hash moves, old one becomes "previous"); the second is
    // still carrying the pre-rotation cookie. Without the grace window this
    // returned null and the caller logged the user out.
    it('validates a just-rotated-out token within the grace window', async () => {
      repository.findOne!.mockResolvedValue(
        baseSession({
          refreshTokenHash: hash('new-token'),
          previousRefreshTokenHash: hash('old-token'),
          previousRefreshTokenExpiresAt: new Date(Date.now() + 5_000),
        }),
      );

      const result = await service.validateSession(1, 2, 'old-token');

      expect(result).not.toBeNull();
    });

    it('rejects a previous token once its grace window has passed', async () => {
      repository.findOne!.mockResolvedValue(
        baseSession({
          refreshTokenHash: hash('new-token'),
          previousRefreshTokenHash: hash('old-token'),
          previousRefreshTokenExpiresAt: new Date(Date.now() - 1_000),
        }),
      );

      const result = await service.validateSession(1, 2, 'old-token');

      expect(result).toBeNull();
    });

    it('rejects a previous-hash match with no recorded expiry', async () => {
      repository.findOne!.mockResolvedValue(
        baseSession({
          refreshTokenHash: hash('new-token'),
          previousRefreshTokenHash: hash('old-token'),
          previousRefreshTokenExpiresAt: null,
        }),
      );

      const result = await service.validateSession(1, 2, 'old-token');

      expect(result).toBeNull();
    });

    it('returns null for a revoked or expired session before hashes are even compared', async () => {
      repository.findOne!.mockResolvedValue(null);

      const result = await service.validateSession(1, 2, 'current-token');

      expect(result).toBeNull();
    });
  });

  describe('attachRefreshToken', () => {
    it('shifts the current hash into the grace window and writes the new one', async () => {
      repository.findOne!.mockResolvedValue({
        refreshTokenHash: hash('old-token'),
      });
      repository.update!.mockResolvedValue({ affected: 1 });

      await service.attachRefreshToken(1, 'new-token');

      expect(repository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          refreshTokenHash: hash('new-token'),
          previousRefreshTokenHash: hash('old-token'),
          previousRefreshTokenExpiresAt: expect.any(Date),
        }),
      );
    });

    it('carries forward the seeded empty hash on the very first attach without special-casing it', async () => {
      repository.findOne!.mockResolvedValue({ refreshTokenHash: '' });
      repository.update!.mockResolvedValue({ affected: 1 });

      await service.attachRefreshToken(1, 'first-token');

      const [, patch] = repository.update!.mock.calls[0];
      // An empty string can never equal a sha256 hex digest, so this is inert
      // — no real token will ever validate against it.
      expect(patch.previousRefreshTokenHash).toBe('');
    });
  });

  describe('revokeStaleSessions', () => {
    it('revokes only sessions whose lastUsedAt is older than 3 days', async () => {
      repository.update!.mockResolvedValue({ affected: 2 });

      const count = await service.revokeStaleSessions();

      expect(count).toBe(2);
      const [criteria, patch] = repository.update!.mock.calls[0];
      expect(criteria).toMatchObject({ revokedAt: expect.anything() });
      expect(criteria.lastUsedAt).toMatchObject({
        _type: 'lessThan',
        _value: expect.any(Date),
      });
      const cutoff = criteria.lastUsedAt._value as Date;
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoff.getTime() - threeDaysAgo)).toBeLessThan(5000);
      expect(patch.revokedAt).toBeInstanceOf(Date);
    });

    it('returns 0 when nothing is stale', async () => {
      repository.update!.mockResolvedValue({ affected: 0 });

      const count = await service.revokeStaleSessions();

      expect(count).toBe(0);
    });

    it('handles an undefined affected count as 0', async () => {
      repository.update!.mockResolvedValue({ affected: undefined });

      const count = await service.revokeStaleSessions();

      expect(count).toBe(0);
    });
  });
});
