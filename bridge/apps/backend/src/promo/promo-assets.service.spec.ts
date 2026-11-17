import { mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Response } from 'express';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { FileStore } from '../storage/file-store/file-store';
import { sendStoredFile } from '../storage/file-store/send-stored-file';
import type { PromoAsset } from './entities/promo-asset.entity';
import { PromoAssetsService } from './promo-assets.service';
import type { PromoPostsService } from './promo-posts.service';

jest.mock('../storage/file-store/send-stored-file', () => ({
  sendStoredFile: jest.fn(),
}));

// A repository that keeps rows in memory: only what the service uses.
class MemoryRepo {
  rows: PromoAsset[] = [];
  saveError: Error | null = null;
  private nextId = 1;

  create(data: Partial<PromoAsset>): PromoAsset {
    return { ...data } as PromoAsset;
  }

  async save(row: PromoAsset): Promise<PromoAsset> {
    if (this.saveError) throw this.saveError;

    if (!row.id) {
      row.id = this.nextId++;
      this.rows.push(row);
    }

    return row;
  }

  async remove(row: PromoAsset): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== row.id);
  }

  async find(): Promise<PromoAsset[]> {
    return [...this.rows].sort((a, b) => b.id - a.id);
  }

  async findOne(options: {
    where: { id: number };
  }): Promise<PromoAsset | null> {
    return this.rows.find((r) => r.id === options.where.id) ?? null;
  }
}

describe('PromoAssetsService', () => {
  let repo: MemoryRepo;
  let events: string[];
  let store: { adopt: jest.Mock; remove: jest.Mock };
  let posts: { detachAsset: jest.Mock };
  let service: PromoAssetsService;
  let dir: string;

  const stage = async (name: string): Promise<string> => {
    const path = join(dir, name);
    await writeFile(path, 'bytes');

    return path;
  };

  const exists = (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );

  const fileOf = (originalname: string, path: string, filename = 'abc.bin') =>
    ({ originalname, path, filename, size: 5 }) as Express.Multer.File;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'promo-assets-'));
    repo = new MemoryRepo();
    events = [];
    store = {
      adopt: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockImplementation(async () => {
        events.push('store.remove');
      }),
    };
    posts = {
      detachAsset: jest.fn().mockImplementation(async () => {
        events.push('detach');
      }),
    };
    const remove = repo.remove.bind(repo);

    repo.remove = async (row) => {
      events.push('row.remove');

      return remove(row);
    };
    service = new PromoAssetsService(
      repo as never,
      store as unknown as FileStore,
      posts as unknown as PromoPostsService,
    );
    jest.mocked(sendStoredFile).mockReset();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('upload', () => {
    it('rejects an unlisted extension, unlinks the staged file and never adopts', async () => {
      const staged = await stage('evil.html');

      await expect(
        service.upload(fileOf('evil.html', staged)),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(await exists(staged)).toBe(false);
      expect(store.adopt).not.toHaveBeenCalled();
      expect(repo.rows).toHaveLength(0);
    });

    it('removes the stored copy and rethrows the original error when save fails', async () => {
      const staged = await stage('a.png');
      const failure = new Error('db down');

      repo.saveError = failure;

      await expect(
        service.upload(fileOf('a.png', staged, 'abc.png')),
      ).rejects.toBe(failure);

      expect(store.remove).toHaveBeenCalledWith('promo/abc.png');
    });

    it('still rethrows the save error when removing the stored copy fails too', async () => {
      const failure = new Error('db down');

      repo.saveError = failure;
      store.remove.mockRejectedValue(new Error('disk'));

      await expect(
        service.upload(fileOf('a.png', await stage('a.png'), 'abc.png')),
      ).rejects.toBe(failure);
    });

    it('adopts the staged file and stores name, mime from the extension and size', async () => {
      const staged = await stage('Photo.JPG');
      const saved = await service.upload(
        fileOf('Photo.JPG', staged, 'xyz.jpg'),
      );

      expect(store.adopt).toHaveBeenCalledWith('promo/xyz.jpg', staged);
      expect(saved).toMatchObject({
        originalName: 'Photo.JPG',
        mime: 'image/jpeg',
        size: 5,
        storedName: 'xyz.jpg',
      });
      expect(repo.rows).toHaveLength(1);
      expect(store.remove).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    const seed = async () =>
      service.upload(fileOf('a.png', await stage('a.png'), 'abc.png'));

    it('detaches post links before deleting the row, then removes the stored file', async () => {
      const asset = await seed();

      await service.remove(asset.id);

      expect(posts.detachAsset).toHaveBeenCalledWith(asset.id);
      expect(events).toEqual(['detach', 'row.remove', 'store.remove']);
      expect(store.remove).toHaveBeenCalledWith('promo/abc.png');
      expect(repo.rows).toHaveLength(0);
    });

    it('swallows a failing store.remove', async () => {
      const asset = await seed();

      store.remove.mockRejectedValue(new Error('disk'));

      await expect(service.remove(asset.id)).resolves.toBeUndefined();
      expect(repo.rows).toHaveLength(0);
    });

    it('answers NotFoundException for an unknown id without detaching', async () => {
      await expect(service.remove(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(posts.detachAsset).not.toHaveBeenCalled();
      expect(store.remove).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    const asset = {
      id: 1,
      originalName: 'Фото 1.png',
      mime: 'image/png',
      storedName: 'abc.png',
    } as PromoAsset;

    const makeRes = (headersSent = false) => {
      const res = {
        headersSent,
        setHeader: jest.fn(),
        status: jest.fn(),
        json: jest.fn(),
      };

      res.status.mockReturnValue(res);

      return res;
    };

    it('sets the sandboxing headers and sends the stored file inline', () => {
      const res = makeRes();

      service.send(res as unknown as Response, asset);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Security-Policy',
        "default-src 'none'; sandbox",
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Content-Type-Options',
        'nosniff',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent('Фото 1.png')}`,
      );
      expect(sendStoredFile).toHaveBeenCalledWith(
        store,
        res,
        'promo/abc.png',
        { kind: 'inline' },
        expect.any(Function),
      );
    });

    it('answers 404 «Файл потерян» on a store error before headers are sent', () => {
      const res = makeRes();

      service.send(res as unknown as Response, asset);

      const done = jest.mocked(sendStoredFile).mock.calls[0][4];

      done(new Error('missing'));

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Файл потерян' });
    });

    it('does not answer again once the headers are sent, or on success', () => {
      const sent = makeRes(true);

      service.send(sent as unknown as Response, asset);
      jest.mocked(sendStoredFile).mock.calls[0][4](new Error('mid-stream'));
      expect(sent.status).not.toHaveBeenCalled();

      const ok = makeRes();

      service.send(ok as unknown as Response, asset);
      jest.mocked(sendStoredFile).mock.calls[1][4]();
      expect(ok.status).not.toHaveBeenCalled();
    });
  });
});
