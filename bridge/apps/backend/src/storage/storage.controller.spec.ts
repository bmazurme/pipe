import type { Response } from 'express';

import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { StoredFile } from './entities/stored-file.entity';

// Plain instantiation, not a full TestingModule — the only thing worth
// covering here is the download route's res.download() callback (see its
// own comment): a missing-on-disk file used to leave the request hanging
// with no response ever sent, instead of a clear 404.
describe('StorageController.download', () => {
  const file = {
    id: 1,
    storedName: 'abc.zip',
    originalName: 'a.zip',
  } as StoredFile;

  function makeResponse(): jest.Mocked<Response> {
    return {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      download: jest.fn(),
    } as unknown as jest.Mocked<Response>;
  }

  function makeService(): jest.Mocked<StorageService> {
    return {
      findOwned: jest.fn().mockResolvedValue(file),
      path: jest.fn().mockReturnValue('/uploads/abc.zip'),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<StorageService>;
  }

  it('deletes the stored file once the download actually succeeds', async () => {
    const service = makeService();
    const res = makeResponse();
    (res.download as jest.Mock).mockImplementation((_path, _name, callback) =>
      callback(null),
    );

    await new StorageController(service).download(1, { id: 7 }, res);

    expect(service.delete).toHaveBeenCalledWith(file);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('sends a 404 instead of hanging when the file is missing on disk, and does not delete the row', async () => {
    const service = makeService();
    const res = makeResponse();
    (res.download as jest.Mock).mockImplementation((_path, _name, callback) =>
      callback(Object.assign(new Error('no such file'), { code: 'ENOENT' })),
    );

    await new StorageController(service).download(1, { id: 7 }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      message: 'File is missing on disk',
    });
    expect(service.delete).not.toHaveBeenCalled();
  });

  it('does not try to write a second response if headers were already sent', async () => {
    const service = makeService();
    const res = makeResponse();
    (res as { headersSent: boolean }).headersSent = true;
    (res.download as jest.Mock).mockImplementation((_path, _name, callback) =>
      callback(new Error('stream interrupted')),
    );

    await new StorageController(service).download(1, { id: 7 }, res);

    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('StorageController.remove', () => {
  const file = {
    id: 1,
    storedName: 'abc.zip',
    originalName: 'a.zip',
  } as StoredFile;

  function makeService(): jest.Mocked<StorageService> {
    return {
      findOwned: jest.fn().mockResolvedValue(file),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<StorageService>;
  }

  it('deletes a file the caller owns, without downloading it', async () => {
    const service = makeService();

    await new StorageController(service).remove(1, { id: 7 });

    expect(service.findOwned).toHaveBeenCalledWith(1, 7);
    expect(service.delete).toHaveBeenCalledWith(file);
  });

  it("propagates findOwned's NotFoundException for a file the caller does not own, without calling delete", async () => {
    const service = makeService();
    service.findOwned.mockRejectedValue(new Error('File not found'));

    await expect(
      new StorageController(service).remove(1, { id: 7 }),
    ).rejects.toThrow('File not found');
    expect(service.delete).not.toHaveBeenCalled();
  });
});
