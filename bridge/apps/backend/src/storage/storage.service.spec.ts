import { join } from 'path';
import { unlink } from 'fs/promises';
import { Logger, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { UPLOAD_DIR } from './config/multer.config';
import { StoredFile, StoredFileDirection } from './entities/stored-file.entity';
import { StorageService } from './storage.service';

jest.mock('fs/promises', () => ({ unlink: jest.fn() }));

const mockUnlink = unlink as jest.Mock;

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

  describe('create failure cleanup', () => {
    const file = {
      originalname: 'a.zip',
      filename: 'stored-a.zip',
      mimetype: 'application/zip',
      size: 123,
    } as Express.Multer.File;

    it('unlinks the uploaded file and rethrows when save fails', async () => {
      const error = new Error('db down');
      repository.save!.mockRejectedValue(error);
      mockUnlink.mockResolvedValue(undefined);

      await expect(service.create(7, file)).rejects.toBe(error);

      expect(mockUnlink).toHaveBeenCalledWith(
        join(UPLOAD_DIR, 'stored-a.zip'),
      );
    });

    it('still rethrows the original error when the cleanup unlink fails', async () => {
      const error = new Error('db down');
      repository.save!.mockRejectedValue(error);
      mockUnlink.mockRejectedValue(new Error('ENOENT'));

      await expect(service.create(7, file)).rejects.toBe(error);
    });
  });

  describe('findOwned', () => {
    it('returns the file when it belongs to the user', async () => {
      const stored = { id: 1, userId: 7 };
      repository.findOne!.mockResolvedValue(stored);

      await expect(service.findOwned(1, 7)).resolves.toBe(stored);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 1, userId: 7 },
      });
    });

    it('throws NotFoundException when no file matches', async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(service.findOwned(1, 7)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("scopes the lookup to the caller so another user's file is not found", async () => {
      // The row exists for user 8 only; the userId-scoped query yields nothing for user 7.
      repository.findOne!.mockImplementation(({ where }) =>
        Promise.resolve(where.userId === 8 ? { id: 1, userId: 8 } : null),
      );

      await expect(service.findOwned(1, 7)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 1, userId: 7 },
      });
    });
  });

  describe('delete', () => {
    const stored = { id: 3, storedName: 'stored-b.zip' } as StoredFile;

    it('removes the row and the file on disk', async () => {
      repository.delete!.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      await service.delete(stored);

      expect(repository.delete).toHaveBeenCalledWith(3);
      expect(mockUnlink).toHaveBeenCalledWith(service.path(stored));
    });

    it('logs and does not throw when unlink fails', async () => {
      repository.delete!.mockResolvedValue(undefined);
      mockUnlink.mockRejectedValue(new Error('EACCES'));
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await expect(service.delete(stored)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('stored-b.zip'),
      );

      warn.mockRestore();
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
