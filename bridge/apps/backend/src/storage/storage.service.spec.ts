import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { StoredFile, StoredFileDirection } from './entities/stored-file.entity';
import { StorageService } from './storage.service';

type MockRepository = Partial<Record<keyof Repository<StoredFile>, jest.Mock>>;

function createMockRepository(): MockRepository {
  return {
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  };
}

describe('StorageService', () => {
  let service: StorageService;
  let repository: MockRepository;

  beforeEach(async () => {
    repository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: getRepositoryToken(StoredFile), useValue: repository },
      ],
    }).compile();

    service = module.get(StorageService);
  });

  describe('create', () => {
    const file = {
      originalname: 'a.zip',
      filename: 'stored-a.zip',
      mimetype: 'application/zip',
      size: 123,
    } as Express.Multer.File;

    it('defaults channel/taskKey/direction to null when no metadata is given', async () => {
      repository.save!.mockImplementation((entity) =>
        Promise.resolve({ id: 1, ...entity }),
      );

      await service.create(7, file);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: null,
          taskKey: null,
          direction: null,
        }),
      );
    });

    it('persists addressing metadata when given', async () => {
      repository.save!.mockImplementation((entity) =>
        Promise.resolve({ id: 1, ...entity }),
      );

      await service.create(7, file, {
        channel: 'issue',
        taskKey: '173:628',
        direction: StoredFileDirection.Outbound,
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'issue',
          taskKey: '173:628',
          direction: StoredFileDirection.Outbound,
        }),
      );
    });
  });

  describe('findAllByUser', () => {
    it('queries by userId alone when no filter is given', async () => {
      repository.find!.mockResolvedValue([]);

      await service.findAllByUser(7);

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: 7 },
        order: { createdAt: 'DESC' },
      });
    });

    it('adds taskKey/channel/direction to the query when filtering', async () => {
      repository.find!.mockResolvedValue([]);

      await service.findAllByUser(7, {
        taskKey: '173:628',
        direction: StoredFileDirection.Result,
      });

      expect(repository.find).toHaveBeenCalledWith({
        where: {
          userId: 7,
          taskKey: '173:628',
          direction: StoredFileDirection.Result,
        },
        order: { createdAt: 'DESC' },
      });
    });
  });
});
