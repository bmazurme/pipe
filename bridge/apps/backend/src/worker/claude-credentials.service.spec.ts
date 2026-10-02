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
