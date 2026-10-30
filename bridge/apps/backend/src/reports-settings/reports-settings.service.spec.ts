import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { ReportsSettingsBackup } from './entities/reports-settings-backup.entity';
import { ReportsSettingsService } from './reports-settings.service';

type MockRepository = Partial<
  Record<keyof Repository<ReportsSettingsBackup>, jest.Mock>
>;

function createMockRepository(): MockRepository {
  return {
    findOneBy: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((entity) => entity),
    save: jest.fn((entity) => entity),
    delete: jest.fn(),
  };
}

describe('ReportsSettingsService', () => {
  let service: ReportsSettingsService;
  let repository: MockRepository;

  beforeEach(async () => {
    repository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsSettingsService,
        {
          provide: getRepositoryToken(ReportsSettingsBackup),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get(ReportsSettingsService);
  });

  describe('findStatusForUser', () => {
    it('does not select the encrypted payload column', async () => {
      repository.findOne!.mockResolvedValue(null);

      await service.findStatusForUser(1);

      const { where, select } = repository.findOne!.mock.calls[0][0];

      expect(where).toEqual({ userId: 1 });
      expect(select).toContain('updatedAt');
      expect(select).not.toContain('payload');
    });
  });

  describe('getForUser', () => {
    it('throws when the user has no backup yet', async () => {
      repository.findOneBy!.mockResolvedValue(null);

      await expect(service.getForUser(1)).rejects.toThrow('ещё не сохранён');
    });

    it('returns the stored backup', async () => {
      repository.findOneBy!.mockResolvedValue({ userId: 1, payload: 'p' });

      await expect(service.getForUser(1)).resolves.toEqual({
        userId: 1,
        payload: 'p',
      });
    });
  });

  describe('upsertForUser', () => {
    it('creates a new row when the user has no backup yet', async () => {
      repository.findOneBy!.mockResolvedValue(null);

      await service.upsertForUser(1, 'payload');

      expect(repository.create).toHaveBeenCalledWith({
        userId: 1,
        payload: 'payload',
      });
      expect(repository.save).toHaveBeenCalledWith({
        userId: 1,
        payload: 'payload',
      });
    });

    it('overwrites the existing row instead of creating a second one', async () => {
      const existing = { userId: 1, payload: 'old' };

      repository.findOneBy!.mockResolvedValue(existing);

      await service.upsertForUser(1, 'new');

      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalledWith({
        userId: 1,
        payload: 'new',
      });
    });
  });

  describe('deleteForUser', () => {
    it('scopes the delete to the given user', async () => {
      await service.deleteForUser(1);

      expect(repository.delete).toHaveBeenCalledWith({ userId: 1 });
    });
  });
});
