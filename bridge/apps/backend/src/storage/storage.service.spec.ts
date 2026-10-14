import { join } from 'path';
import { Logger, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { UPLOAD_DIR } from './config/multer.config';
import { StoredFile, StoredFileDirection } from './entities/stored-file.entity';
import { FILE_STORE } from './file-store/file-store';
import { StorageService } from './storage.service';

// The store behind StorageService is faked: its own behaviour is covered in file-store/*.spec.ts.
function createMockStore() {
  return {
    driver: 'local' as const,
    adopt: jest.fn().mockResolvedValue(undefined),
    put: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn(),
    openRead: jest.fn(),
    readBytes: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
    localPath: jest.fn().mockReturnValue(null),
  };
}

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
  let store: ReturnType<typeof createMockStore>;

  beforeEach(async () => {
    repository = createMockRepository();
    store = createMockStore();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: getRepositoryToken(StoredFile), useValue: repository },
        { provide: FILE_STORE, useValue: store },
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

  describe('where the file goes', () => {
    const file = {
      originalname: 'a.zip',
      filename: 'stored-a.zip',
      mimetype: 'application/zip',
      size: 123,
    } as Express.Multer.File;

    it('hands the staged upload to the store before recording it', async () => {
      repository.save!.mockResolvedValue({ id: 1 });

      await service.create(7, file);

      expect(store.adopt).toHaveBeenCalledWith(
        'stored-a.zip',
        join(UPLOAD_DIR, 'stored-a.zip'),
      );
      expect(store.adopt.mock.invocationCallOrder[0]).toBeLessThan(
        repository.save!.mock.invocationCallOrder[0],
      );
    });

    it("uses multer's own path for the staged file when it has one", async () => {
      repository.save!.mockResolvedValue({ id: 1 });

      await service.create(7, { ...file, path: '/tmp/staging/x.zip' });

      expect(store.adopt).toHaveBeenCalledWith(
        'stored-a.zip',
        '/tmp/staging/x.zip',
      );
    });

    it('records nothing when the store cannot take the file', async () => {
      const error = new Error('bucket unreachable');
      store.adopt.mockRejectedValue(error);

      await expect(service.create(7, file)).rejects.toBe(error);

      expect(repository.save).not.toHaveBeenCalled();
    });

    it('stores the bytes of a file bridge made itself under a fresh name and records them', async () => {
      repository.save!.mockImplementation((entity) =>
        Promise.resolve({ id: 5, ...entity }),
      );

      const stored = await service.createFromBuffer(
        7,
        Buffer.from('zip'),
        'p.zip',
        {
          channel: 'issue',
        },
      );

      const [key, bytes] = store.put.mock.calls[0];

      expect(key).toMatch(/^[0-9a-f-]{36}\.zip$/);
      expect(bytes).toEqual(Buffer.from('zip'));
      expect(stored).toMatchObject({
        storedName: key,
        size: 3,
        channel: 'issue',
      });
      expect(store.adopt).not.toHaveBeenCalled();
    });
  });

  describe('create failure cleanup', () => {
    const file = {
      originalname: 'a.zip',
      filename: 'stored-a.zip',
      mimetype: 'application/zip',
      size: 123,
    } as Express.Multer.File;

    it('removes the stored file and rethrows when save fails', async () => {
      const error = new Error('db down');
      repository.save!.mockRejectedValue(error);

      await expect(service.create(7, file)).rejects.toBe(error);

      expect(store.remove).toHaveBeenCalledWith('stored-a.zip');
    });

    it('still rethrows the original error when the cleanup fails', async () => {
      const error = new Error('db down');
      repository.save!.mockRejectedValue(error);
      store.remove.mockRejectedValue(new Error('bucket unreachable'));

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

    it('removes the row and the stored file', async () => {
      repository.delete!.mockResolvedValue(undefined);

      await service.delete(stored);

      expect(repository.delete).toHaveBeenCalledWith(3);
      expect(store.remove).toHaveBeenCalledWith('stored-b.zip');
    });

    it('logs and does not throw when the file cannot be removed', async () => {
      repository.delete!.mockResolvedValue(undefined);
      store.remove.mockRejectedValue(new Error('EACCES'));
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

  describe('pruneStale', () => {
    const original = process.env.STORAGE_RETENTION_DAYS;

    afterEach(() => {
      jest.restoreAllMocks();

      if (original === undefined) {
        delete process.env.STORAGE_RETENTION_DAYS;
      } else {
        process.env.STORAGE_RETENTION_DAYS = original;
      }
    });

    it('does nothing when the variable is unset or 0', async () => {
      delete process.env.STORAGE_RETENTION_DAYS;
      await expect(service.pruneStale()).resolves.toBe(0);

      process.env.STORAGE_RETENTION_DAYS = '0';
      await expect(service.pruneStale()).resolves.toBe(0);

      expect(repository.find).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('deletes rows older than the cutoff from the db and the store', async () => {
      process.env.STORAGE_RETENTION_DAYS = '7';
      repository
        .find!.mockResolvedValueOnce([
          { id: 1, storedName: 'a.zip' },
          { id: 2, storedName: 'b.zip' },
        ])
        .mockResolvedValueOnce([]);
      repository.delete!.mockResolvedValue({ affected: 1 });

      const before = Date.now();
      await expect(service.pruneStale()).resolves.toBe(2);

      const where = (
        repository.find!.mock.calls[0] as [
          { where: { createdAt: { value: Date } } },
        ]
      )[0].where;
      const cutoff = where.createdAt.value.getTime();
      expect(cutoff).toBeLessThanOrEqual(before - 7 * 86_400_000 + 1000);
      expect(cutoff).toBeGreaterThan(before - 7 * 86_400_000 - 5000);
      expect(repository.delete).toHaveBeenCalledWith(1);
      expect(repository.delete).toHaveBeenCalledWith(2);
      expect(store.remove).toHaveBeenCalledWith('a.zip');
      expect(store.remove).toHaveBeenCalledWith('b.zip');
    });

    it('keeps going when one delete fails and does not throw', async () => {
      process.env.STORAGE_RETENTION_DAYS = '7';
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      repository
        .find!.mockResolvedValueOnce([
          { id: 1, storedName: 'a.zip' },
          { id: 2, storedName: 'b.zip' },
        ])
        .mockResolvedValueOnce([]);
      repository
        .delete!.mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce({ affected: 1 });

      await expect(service.pruneStale()).resolves.toBe(1);

      expect(store.remove).toHaveBeenCalledTimes(1);
      expect(store.remove).toHaveBeenCalledWith('b.zip');
    });

    it('does not throw when listing fails', async () => {
      process.env.STORAGE_RETENTION_DAYS = '7';
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      repository.find!.mockRejectedValue(new Error('db down'));

      await expect(service.pruneStale()).resolves.toBe(0);
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
  describe('reading and sending', () => {
    const stored = {
      id: 3,
      storedName: 'stored-b.zip',
      originalName: 'b.zip',
    } as StoredFile;

    it('reads the bytes of a stored file through the store', async () => {
      store.readBytes.mockResolvedValue(Buffer.from('bytes'));

      await expect(service.readBytes(stored)).resolves.toEqual(
        Buffer.from('bytes'),
      );
      expect(store.readBytes).toHaveBeenCalledWith('stored-b.zip');
    });

    it('says whether the content of a stored record is still there', async () => {
      store.stat.mockResolvedValueOnce({ size: 5 });
      await expect(service.exists(stored)).resolves.toBe(true);
      expect(store.stat).toHaveBeenCalledWith('stored-b.zip');

      store.stat.mockResolvedValueOnce(null);
      await expect(service.exists(stored)).resolves.toBe(false);
    });

    it('lets Express send a plain local file as a download under its original name', () => {
      store.localPath.mockReturnValue('/app/uploads/stored-b.zip');
      const res = { download: jest.fn() };
      const done = jest.fn();

      service.download(res as never, stored, done);

      expect(res.download).toHaveBeenCalledWith(
        '/app/uploads/stored-b.zip',
        'b.zip',
        done,
      );
    });
  });
});
