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

      expect(result).toEqual({ userId: apiKey.userId });
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
});
