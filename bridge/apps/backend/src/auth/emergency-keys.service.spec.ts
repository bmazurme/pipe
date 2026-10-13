import { createHash } from 'crypto';

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  EMERGENCY_KEY_PREFIX,
  EmergencyKeysService,
} from './emergency-keys.service';
import { EmergencyKey } from './entities/emergency-key.entity';

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

describe('EmergencyKeysService', () => {
  let service: EmergencyKeysService;
  const repository = {
    upsert: jest.fn(),
    findOneByOrFail: jest.fn(),
    findOneBy: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmergencyKeysService,
        { provide: getRepositoryToken(EmergencyKey), useValue: repository },
      ],
    }).compile();

    service = module.get(EmergencyKeysService);
  });

  describe('createOrReplace', () => {
    it('returns a long, recognisable token once and stores only its hash', async () => {
      repository.findOneByOrFail.mockResolvedValue({
        updatedAt: new Date('2026-10-13T12:00:00Z'),
      });

      const created = await service.createOrReplace(4);

      expect(created.token.startsWith(EMERGENCY_KEY_PREFIX)).toBe(true);
      expect(created.token.length).toBeGreaterThan(40);
      expect(created.prefix).toBe(created.token.slice(0, 12));
      const [row] = repository.upsert.mock.calls[0] as [
        { userId: number; keyHash: string; prefix: string },
      ];

      expect(row.userId).toBe(4);
      expect(row.keyHash).toBe(hash(created.token));
      expect(JSON.stringify(row)).not.toContain(created.token);
    });

    it('replaces the user’s previous key in a single upsert keyed by user', async () => {
      repository.findOneByOrFail.mockResolvedValue({ updatedAt: new Date() });

      await service.createOrReplace(4);

      expect(repository.upsert).toHaveBeenCalledWith(expect.any(Object), [
        'userId',
      ]);
    });

    it('generates a different token every time', async () => {
      repository.findOneByOrFail.mockResolvedValue({ updatedAt: new Date() });

      const a = await service.createOrReplace(4);
      const b = await service.createOrReplace(4);

      expect(a.token).not.toBe(b.token);
    });
  });

  describe('status', () => {
    it('reports no key', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.status(4)).resolves.toEqual({
        exists: false,
        prefix: null,
        createdAt: null,
        lastUsedAt: null,
      });
    });

    it('reports the key without ever exposing the hash', async () => {
      const when = new Date('2026-10-13T12:00:00Z');

      repository.findOneBy.mockResolvedValue({
        prefix: 'bre_AAAAAAAA',
        keyHash: 'secret-hash',
        updatedAt: when,
        lastUsedAt: null,
      });

      const status = await service.status(4);

      expect(status).toEqual({
        exists: true,
        prefix: 'bre_AAAAAAAA',
        createdAt: when,
        lastUsedAt: null,
      });
      expect(JSON.stringify(status)).not.toContain('secret-hash');
    });
  });

  describe('redeem', () => {
    it('refuses anything that is not an emergency token without touching the database', async () => {
      await expect(service.redeem('brk_apikey')).resolves.toBeNull();
      await expect(service.redeem('')).resolves.toBeNull();
      expect(repository.findOneBy).not.toHaveBeenCalled();
    });

    it('looks the key up by its hash and returns the owner, marking the use', async () => {
      repository.findOneBy.mockResolvedValue({ id: 9, userId: 4 });

      await expect(service.redeem('bre_token')).resolves.toBe(4);
      expect(repository.findOneBy).toHaveBeenCalledWith({
        keyHash: hash('bre_token'),
      });
      expect(repository.update).toHaveBeenCalledWith(9, {
        lastUsedAt: expect.any(Date) as Date,
      });
    });

    it('returns null for a token that matches no key', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.redeem('bre_nope')).resolves.toBeNull();
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('says whether there was a key to revoke', async () => {
      repository.delete.mockResolvedValueOnce({ affected: 1 });
      repository.delete.mockResolvedValueOnce({ affected: 0 });

      await expect(service.revoke(4)).resolves.toBe(true);
      await expect(service.revoke(4)).resolves.toBe(false);
    });
  });
});
