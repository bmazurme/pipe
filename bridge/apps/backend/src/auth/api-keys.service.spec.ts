import { Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';

import { API_KEY_PREFIX, ApiKeysService } from './api-keys.service';
import { ApiKey } from './entities/api-key.entity';

type MockRepository = Partial<Record<keyof Repository<ApiKey>, jest.Mock>>;

function createMockRepository(): MockRepository {
  return {
    create: jest.fn((value) => value),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
}

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

function baseApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 1,
    userId: 2,
    name: 'sync-cli',
    prefix: 'brk_AAAAAAAA',
    keyHash: hash('some-token'),
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ApiKey;
}

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let repository: MockRepository;

  beforeEach(async () => {
    repository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: getRepositoryToken(ApiKey), useValue: repository },
      ],
    }).compile();

    service = module.get(ApiKeysService);
  });

  describe('expiry', () => {
    it('create sets expiresAt from expiresInDays, 90 days when omitted, never only when asked (null)', async () => {
      repository.save!.mockImplementation(async (e) => ({
        id: 1,
        createdAt: new Date(),
        ...e,
      }));
      const withExpiry = await service.create(2, 'k', null, 30);
      const diff = withExpiry.expiresAt!.getTime() - Date.now();
      expect(Math.abs(diff - 30 * 86_400_000)).toBeLessThan(5_000);
      const byDefault = await service.create(2, 'k');
      expect(
        Math.abs(byDefault.expiresAt!.getTime() - Date.now() - 90 * 86_400_000),
      ).toBeLessThan(5_000);
      const never = await service.create(2, 'k', null, null);
      expect(never.expiresAt).toBeNull();
    });

    it('validate refuses an expired key and accepts a future or null expiry', async () => {
      const token = `${API_KEY_PREFIX}abc`;
      repository.findOne!.mockResolvedValue(
        baseApiKey({ expiresAt: new Date(Date.now() - 1000) }),
      );
      expect(await service.validate(token)).toBeNull();
      repository.update!.mockResolvedValue({});
      repository.findOne!.mockResolvedValue(
        baseApiKey({ expiresAt: new Date(Date.now() + 100_000) }),
      );
      expect(await service.validate(token)).toEqual({ userId: 2, scope: null });
      repository.findOne!.mockResolvedValue(baseApiKey({ expiresAt: null }));
      expect(await service.validate(token)).toEqual({ userId: 2, scope: null });
    });
  });

  describe('create', () => {
    it('generates a brk_-prefixed token, saves only its hash, and returns the plaintext once', async () => {
      repository.save!.mockImplementation(async (entity) => ({
        id: 42,
        createdAt: new Date(),
        ...entity,
      }));

      const created = await service.create(2, 'sync-cli on macbook');

      expect(created.token.startsWith(API_KEY_PREFIX)).toBe(true);
      expect(created.prefix).toBe(created.token.slice(0, 12));
      expect(created.name).toBe('sync-cli on macbook');

      const saveArg = repository.save!.mock.calls[0][0];
      expect(saveArg.keyHash).toBe(hash(created.token));
      expect(saveArg).not.toHaveProperty('token');
    });
  });

  describe('validate', () => {
    it('resolves the owning user for a token matching an active key', async () => {
      const apiKey = baseApiKey({
        keyHash: hash(`${API_KEY_PREFIX}real-token`),
      });
      repository.findOne!.mockResolvedValue(apiKey);
      repository.update!.mockResolvedValue({ affected: 1 });

      const result = await service.validate(`${API_KEY_PREFIX}real-token`);

      expect(result).toEqual({ userId: apiKey.userId, scope: null });
    });

    it('bumps lastUsedAt on a successful validation', async () => {
      const apiKey = baseApiKey({
        keyHash: hash(`${API_KEY_PREFIX}real-token`),
      });
      repository.findOne!.mockResolvedValue(apiKey);
      repository.update!.mockResolvedValue({ affected: 1 });

      await service.validate(`${API_KEY_PREFIX}real-token`);

      expect(repository.update).toHaveBeenCalledWith(apiKey.id, {
        lastUsedAt: expect.any(Date),
      });
    });

    it('does not write lastUsedAt again while it is under a minute old', async () => {
      const apiKey = baseApiKey({
        keyHash: hash(`${API_KEY_PREFIX}real-token`),
        lastUsedAt: new Date(Date.now() - 10_000),
      });
      repository.findOne!.mockResolvedValue(apiKey);

      await service.validate(`${API_KEY_PREFIX}real-token`);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('writes lastUsedAt again once it is older than a minute', async () => {
      const apiKey = baseApiKey({
        keyHash: hash(`${API_KEY_PREFIX}real-token`),
        lastUsedAt: new Date(Date.now() - 120_000),
      });
      repository.findOne!.mockResolvedValue(apiKey);
      repository.update!.mockResolvedValue({ affected: 1 });

      await service.validate(`${API_KEY_PREFIX}real-token`);

      expect(repository.update).toHaveBeenCalledTimes(1);
    });

    it('still resolves the user, logs a warning and raises no unhandled rejection when the lastUsedAt update fails', async () => {
      const apiKey = baseApiKey({
        keyHash: hash(`${API_KEY_PREFIX}real-token`),
      });
      repository.findOne!.mockResolvedValue(apiKey);
      repository.update!.mockRejectedValue(new Error('db down'));
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);

      const result = await service.validate(`${API_KEY_PREFIX}real-token`);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      process.off('unhandledRejection', unhandled);
      expect(result).toEqual({ userId: apiKey.userId, scope: null });
      expect(unhandled).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));

      warn.mockRestore();
    });

    it('rejects a token with no matching hash', async () => {
      repository.findOne!.mockResolvedValue(null);

      const result = await service.validate(`${API_KEY_PREFIX}unknown-token`);

      expect(result).toBeNull();
    });

    it('rejects a token that does not even look like one of ours, without a DB lookup', async () => {
      const result = await service.validate('not-a-brk-token');

      expect(result).toBeNull();
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('looks up only active (non-revoked) keys', async () => {
      repository.findOne!.mockResolvedValue(null);

      await service.validate(`${API_KEY_PREFIX}revoked-token`);

      const where = repository.findOne!.mock.calls[0][0].where;
      expect(where.revokedAt).toBeDefined();
    });
  });

  describe('findActiveByUser', () => {
    it('excludes revoked keys', async () => {
      repository.find!.mockResolvedValue([baseApiKey()]);

      await service.findActiveByUser(2);

      const where = repository.find!.mock.calls[0][0].where;
      expect(where.userId).toBe(2);
      expect(where.revokedAt).toBeDefined();
    });
  });

  describe('revoke', () => {
    it("revokes a key scoped to its owner's id", async () => {
      repository.update!.mockResolvedValue({ affected: 1 });

      const result = await service.revoke(1, 2);

      expect(result).toBe(true);
      expect(repository.update).toHaveBeenCalledWith(
        { id: 1, userId: 2, revokedAt: expect.anything() },
        { revokedAt: expect.any(Date) },
      );
    });

    it('returns false when nothing matched (wrong owner, already revoked, or missing)', async () => {
      repository.update!.mockResolvedValue({ affected: 0 });

      const result = await service.revoke(1, 999);

      expect(result).toBe(false);
    });
  });

  describe('rotate (S5)', () => {
    const old = (over: Partial<ApiKey> = {}) =>
      baseApiKey({
        scope: 'reports-sync',
        createdAt: new Date(Date.now() - 10 * 86_400_000),
        expiresAt: new Date(Date.now() + 80 * 86_400_000),
        ...over,
      });

    beforeEach(() => {
      repository.save!.mockImplementation(async (e) => ({
        id: 9,
        createdAt: new Date(),
        ...e,
      }));
    });

    it('makes a new key of the same name, scope and term and revokes the old one', async () => {
      // 1st findOne: the key to rotate; 2nd: «is the old hash still active?»
      repository
        .findOne!.mockResolvedValueOnce(old())
        .mockResolvedValueOnce(null);
      repository.update!.mockResolvedValue({ affected: 1 });

      const created = await service.rotate(1, 2);

      expect(created).toMatchObject({
        id: 9,
        name: 'sync-cli',
        scope: 'reports-sync',
      });
      expect(created!.token.startsWith(API_KEY_PREFIX)).toBe(true);
      expect(created!.expiresAt!.getTime() - Date.now()).toBeGreaterThan(
        89 * 86_400_000,
      );
      expect(created!.expiresAt!.getTime() - Date.now()).toBeLessThan(
        91 * 86_400_000,
      );
      expect(repository.update).toHaveBeenCalledWith(
        { id: 1, userId: 2, revokedAt: expect.anything() },
        { revokedAt: expect.any(Date) },
      );
    });

    it('keeps a never-expiring key never-expiring', async () => {
      repository
        .findOne!.mockResolvedValueOnce(old({ expiresAt: null }))
        .mockResolvedValueOnce(null);
      repository.update!.mockResolvedValue({ affected: 1 });

      expect((await service.rotate(1, 2))!.expiresAt).toBeNull();
    });

    it('checks that the old key is dead, and undoes the rotation when it is not', async () => {
      // the old hash is still found active afterwards
      repository
        .findOne!.mockResolvedValueOnce(old())
        .mockResolvedValueOnce(old());
      repository.update!.mockResolvedValue({ affected: 1 });

      await expect(service.rotate(1, 2)).rejects.toThrow('nothing was changed');
      // the new key (id 9) was revoked again
      expect(repository.update).toHaveBeenCalledWith(
        { id: 9, userId: 2, revokedAt: expect.anything() },
        { revokedAt: expect.any(Date) },
      );
    });

    it('undoes the rotation when the old key could not be revoked', async () => {
      repository
        .findOne!.mockResolvedValueOnce(old())
        .mockResolvedValueOnce(null);
      repository
        .update!.mockResolvedValueOnce({ affected: 0 })
        .mockResolvedValue({ affected: 1 });

      await expect(service.rotate(1, 2)).rejects.toThrow('nothing was changed');
    });

    it("is null for a key that is not the user's or already revoked, and makes nothing", async () => {
      repository.findOne!.mockResolvedValue(null);

      expect(await service.rotate(1, 2)).toBeNull();
      expect(repository.save).not.toHaveBeenCalled();
    });
  });
});
