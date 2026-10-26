import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { IsNull, Repository } from 'typeorm';

import { ClaudeCredential } from './entities/claude-credential.entity';
import { Job } from './entities/job.entity';
import { ClaudeCredentialsService } from './claude-credentials.service';

type MockRepository = Partial<
  Record<keyof Repository<ClaudeCredential>, jest.Mock>
>;

function createMockRepository(): MockRepository {
  return {
    create: jest.fn((partial) => partial),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  };
}

describe('ClaudeCredentialsService', () => {
  let service: ClaudeCredentialsService;
  let repository: MockRepository;
  let jobGetRawMany: jest.Mock;
  let jobBuilder: Record<string, jest.Mock>;

  beforeEach(async () => {
    repository = createMockRepository();
    jobGetRawMany = jest.fn().mockResolvedValue([]);
    jobBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jobGetRawMany,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaudeCredentialsService,
        { provide: getRepositoryToken(ClaudeCredential), useValue: repository },
        {
          provide: getRepositoryToken(Job),
          useValue: { createQueryBuilder: jest.fn(() => jobBuilder) },
        },
      ],
    }).compile();

    service = module.get(ClaudeCredentialsService);
  });

  describe('recentUsage', () => {
    const since = new Date('2026-10-10T00:00:00Z');

    it('maps the grouped sums per token, scoped to the user and the window', async () => {
      jobGetRawMany.mockResolvedValue([
        { credentialId: 3, runs: '14', costUsd: '3.2000', tokens: '1200000' },
        { credentialId: 4, runs: '2', costUsd: null, tokens: '500' },
      ]);

      const usage = await service.recentUsage(7, since);

      expect(usage.get(3)).toEqual({ runs: 14, costUsd: 3.2, tokens: 1200000 });
      expect(usage.get(4)).toEqual({ runs: 2, costUsd: null, tokens: 500 });
      expect(jobBuilder.where).toHaveBeenCalledWith('job.userId = :userId', {
        userId: 7,
      });
      expect(jobBuilder.andWhere).toHaveBeenCalledWith(
        'job.createdAt >= :since',
        { since },
      );
      expect(jobBuilder.andWhere).toHaveBeenCalledWith('job.usage IS NOT NULL');
    });

    it('has no entry for a token with no runs', async () => {
      const usage = await service.recentUsage(7, since);

      expect(usage.size).toBe(0);
      expect(usage.get(9)).toBeUndefined();
    });
  });

  describe('create', () => {
    it('saves a named credential scoped to the user', async () => {
      repository.save!.mockImplementation((entity) =>
        Promise.resolve({ id: 1, ...entity }),
      );

      const credential = await service.create(7, 'personal', 'sk-ant-oat-test');

      expect(repository.create).toHaveBeenCalledWith({
        userId: 7,
        name: 'personal',
        token: 'sk-ant-oat-test',
      });
      expect(credential).toMatchObject({ id: 1, name: 'personal' });
    });
  });

  describe('findAllByUser', () => {
    it('orders by id ascending so the first result is the default pick', async () => {
      repository.find!.mockResolvedValue([]);

      await service.findAllByUser(7);

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: 7 },
        order: { id: 'ASC' },
      });
    });
  });

  describe('remove', () => {
    it('throws when nothing owned by the user matched', async () => {
      repository.delete!.mockResolvedValue({ affected: 0 });

      await expect(service.remove(1, 7)).rejects.toThrow(NotFoundException);
    });

    it('deletes a credential owned by the user', async () => {
      repository.delete!.mockResolvedValue({ affected: 1 });

      await service.remove(1, 7);

      expect(repository.delete).toHaveBeenCalledWith({ id: 1, userId: 7 });
    });
  });

  describe('resolveForRun', () => {
    it('uses the credential the job picked', async () => {
      repository.findOne!.mockResolvedValueOnce({ id: 7, token: 'picked' });

      await expect(service.resolveForRun(1, 7)).resolves.toEqual({
        id: 7,
        token: 'picked',
      });
      expect(repository.findOne).toHaveBeenCalledTimes(1);
    });

    it("uses the worker's own token when the job picked none", async () => {
      repository.findOne!.mockResolvedValueOnce({
        id: 4,
        token: 'worker-token',
      });

      await expect(service.resolveForRun(1, null, 4)).resolves.toEqual({
        id: 4,
        token: 'worker-token',
      });
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 4, userId: 1 },
      });
    });

    it("prefers what the job picked over the worker's token", async () => {
      repository.findOne!.mockResolvedValueOnce({ id: 7, token: 'picked' });

      await expect(service.resolveForRun(1, 7, 4)).resolves.toEqual({
        id: 7,
        token: 'picked',
      });
    });

    it("falls to the first token when the worker's was deleted", async () => {
      repository
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 1, token: 'first' });

      await expect(service.resolveForRun(1, null, 4)).resolves.toEqual({
        id: 1,
        token: 'first',
      });
    });

    it("falls back to the account's first token when none was picked", async () => {
      repository.findOne!.mockResolvedValueOnce({ id: 1, token: 'first' });

      await expect(service.resolveForRun(1, null)).resolves.toEqual({
        id: 1,
        token: 'first',
      });
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { userId: 1, authFailedAt: IsNull() },
        order: { id: 'ASC' },
      });
    });

    describe('with rejected tokens', () => {
      const stub = (marked: number[]) =>
        repository.findOne!.mockImplementation(
          ({ where }: { where: Record<string, unknown> }) =>
            Promise.resolve(
              [1, 2]
                .map((id) => ({
                  id,
                  token: `t${id}`,
                  authFailedAt: marked.includes(id) ? new Date() : null,
                }))
                .find(
                  (t) =>
                    (where.id === undefined || where.id === t.id) &&
                    (where.authFailedAt === undefined ||
                      t.authFailedAt === null),
                ) ?? null,
            ),
        );

      it('skips a marked token in the last fallback', async () => {
        stub([1]);

        await expect(service.resolveForRun(1, null)).resolves.toEqual({
          id: 2,
          token: 't2',
        });
      });

      it('still returns the oldest token when every token is marked', async () => {
        stub([1, 2]);

        await expect(service.resolveForRun(1, null)).resolves.toEqual({
          id: 1,
          token: 't1',
        });
      });

      it('keeps an explicit pick even when it is marked', async () => {
        stub([1]);

        await expect(service.resolveForRun(1, 1)).resolves.toEqual({
          id: 1,
          token: 't1',
        });
      });
    });

    it('falls back to the first one when the picked credential was deleted', async () => {
      repository
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 1, token: 'first' });

      await expect(service.resolveForRun(1, 7)).resolves.toEqual({
        id: 1,
        token: 'first',
      });
    });

    it('is null for an account with no tokens at all', async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(service.resolveForRun(1, null)).resolves.toBeNull();
    });
  });

  describe('auth failure mark', () => {
    it('stamps the time and the job on the token', async () => {
      await service.markAuthFailed(3, 7, 42);

      expect(repository.update).toHaveBeenCalledWith(
        { id: 3, userId: 7 },
        { authFailedAt: expect.any(Date), authFailedJobId: 42 },
      );
    });

    it('clears both fields, only when set', async () => {
      await service.clearAuthFailed(3, 7);

      expect(repository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 3, userId: 7 }),
        { authFailedAt: null, authFailedJobId: null },
      );
    });
  });

  describe('resolveToken', () => {
    it('returns null when no matching credential exists for this user', async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(service.resolveToken(1, 7)).resolves.toBeNull();
    });

    it("returns the credential's raw token", async () => {
      repository.findOne!.mockResolvedValue({
        id: 1,
        token: 'sk-ant-oat-test',
      });

      await expect(service.resolveToken(1, 7)).resolves.toBe('sk-ant-oat-test');
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 1, userId: 7 },
      });
    });
  });

  describe('replaceToken', () => {
    it('stores the new token on the same row and clears the old rejection and limits', async () => {
      const row = {
        id: 3,
        userId: 7,
        name: 'личный',
        token: 'old',
        limits: { windows: [] },
        authFailedAt: new Date(),
        authFailedJobId: 9,
      };
      repository.findOne!.mockResolvedValue(row);
      repository.save!.mockImplementation(async (value) => value);

      const result = await service.replaceToken(3, 7, 'new');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 3, userId: 7 },
      });
      expect(result).toMatchObject({
        id: 3,
        name: 'личный',
        token: 'new',
        limits: null,
        authFailedAt: null,
        authFailedJobId: null,
      });
    });

    it("throws 404 when the token is not the caller's", async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(service.replaceToken(3, 8, 'new')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('keeps a worker-pinned token resolvable, now to the new value', async () => {
      const row = { id: 3, userId: 7, token: 'old' };
      repository.findOne!.mockImplementation(async () => ({ ...row }));
      repository.save!.mockImplementation(async (value) => {
        row.token = value.token;
        return value;
      });

      await service.replaceToken(3, 7, 'new');

      await expect(service.resolveForRun(7, null, 3)).resolves.toEqual({
        id: 3,
        token: 'new',
      });
    });
  });
});
