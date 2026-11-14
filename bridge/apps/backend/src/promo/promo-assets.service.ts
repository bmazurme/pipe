import { unlink } from 'fs/promises';
import { join } from 'path';
import type { Response } from 'express';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { FILE_STORE, type FileStore } from '../storage/file-store/file-store';
import { sendStoredFile } from '../storage/file-store/send-stored-file';
import { assetMime, PROMO_UPLOAD_DIR } from './config/promo-multer.config';
import { PromoAsset } from './entities/promo-asset.entity';
import { PromoPostsService } from './promo-posts.service';

const assetKey = (storedName: string) => `promo/${storedName}`;

@Injectable()
export class PromoAssetsService {
  constructor(
    @InjectRepository(PromoAsset)
    private readonly assets: Repository<PromoAsset>,
    @Inject(FILE_STORE) private readonly store: FileStore,
    private readonly posts: PromoPostsService,
  ) {}

  list(): Promise<PromoAsset[]> {
    return this.assets.find({ order: { id: 'DESC' } });
  }

  async upload(file: Express.Multer.File): Promise<PromoAsset> {
    const staged = file.path ?? join(PROMO_UPLOAD_DIR, file.filename);
    const mime = assetMime(file.originalname);

    if (!mime) {
      await unlink(staged).catch(() => undefined);
      throw new BadRequestException('Этот тип файла нельзя прикрепить');
    }

    // adopt() moves the staged file into the store (and removes the staged copy, also when the move fails).
    await this.store.adopt(assetKey(file.filename), staged);

    try {
      return await this.assets.save(
        this.assets.create({
          originalName: file.originalname,
          mime,
          size: file.size,
          storedName: file.filename,
        }),
      );
    } catch (error) {
      await this.store.remove(assetKey(file.filename)).catch(() => undefined);
      throw error;
    }
  }

  async remove(id: number): Promise<void> {
    const asset = await this.get(id);

    await this.posts.detachAsset(id);
    await this.assets.remove(asset);
    await this.store.remove(assetKey(asset.storedName)).catch(() => undefined);
  }

  async get(id: number): Promise<PromoAsset> {
    const asset = await this.assets.findOne({ where: { id } });

    if (!asset) throw new NotFoundException('Файл не найден');

    return asset;
  }

  // The bytes, for the preview in the editor. Never rendered as a page.
  send(res: Response, asset: PromoAsset): void {
    res.setHeader('Content-Type', asset.mime);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
    );
    sendStoredFile(
      this.store,
      res,
      assetKey(asset.storedName),
      { kind: 'inline' },
      (error) => {
        if (error && !res.headersSent) {
          res.status(404).json({ message: 'Файл потерян' });
        }
      },
    );
  }
}
