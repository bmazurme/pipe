import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { ClaudeCredential } from './entities/claude-credential.entity';
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
  };
}

describe('ClaudeCredentialsService', () => {
  let service: ClaudeCredentialsService;
  let repository: MockRepository;

  beforeEach(async () => {
    repository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaudeCredentialsService,
        { provide: getRepositoryToken(ClaudeCredential), useValue: repository },
      ],
    }).compile();

    service = module.get(ClaudeCredentialsService);
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
      repository.findOne!.mockResolvedValueOnce({ token: 'picked' });

      await expect(service.resolveForRun(1, 7)).resolves.toBe('picked');
      expect(repository.findOne).toHaveBeenCalledTimes(1);
    });

    it("uses the worker's own token when the job picked none", async () => {
      repository.findOne!.mockResolvedValueOnce({ token: 'worker-token' });

      await expect(service.resolveForRun(1, null, 4)).resolves.toBe(
        'worker-token',
      );
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 4, userId: 1 },
      });
    });

    it("prefers what the job picked over the worker's token", async () => {
      repository.findOne!.mockResolvedValueOnce({ token: 'picked' });

      await expect(service.resolveForRun(1, 7, 4)).resolves.toBe('picked');
    });

    it("falls to the first token when the worker's was deleted", async () => {
      repository
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ token: 'first' });

      await expect(service.resolveForRun(1, null, 4)).resolves.toBe('first');
    });

    it("falls back to the account's first token when none was picked", async () => {
      repository.findOne!.mockResolvedValueOnce({ token: 'first' });

      await expect(service.resolveForRun(1, null)).resolves.toBe('first');
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { userId: 1 },
        order: { id: 'ASC' },
      });
    });

    it('falls back to the first one when the picked credential was deleted', async () => {
      repository
        .findOne!.mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ token: 'first' });

      await expect(service.resolveForRun(1, 7)).resolves.toBe('first');
    });

    it('is null for an account with no tokens at all', async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(service.resolveForRun(1, null)).resolves.toBeNull();
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
});
