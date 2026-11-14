import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { extname } from 'path';

import {
  decodeMultipartName,
  diskStorageIn,
  ensureUploadDir,
} from '../../uploads/upload-files';
import { LANDING_MAX_ZIP_BYTES } from '../landing-files';

// multer's staging directory only: the services move the file on (into the FileStore) or delete it.
export const PROMO_UPLOAD_DIR = ensureUploadDir('promo');

export const MAX_ASSET_BYTES = 200 * 1024 * 1024;

export const ASSET_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

export function assetMime(name: string): string | undefined {
  return ASSET_MIME[extname(name).toLowerCase()];
}

export const assetMulterConfig: MulterOptions = {
  storage: diskStorageIn(PROMO_UPLOAD_DIR),
  limits: { fileSize: MAX_ASSET_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!assetMime(decodeMultipartName(file.originalname))) {
      callback(
        new BadRequestException(
          `Этот тип файла нельзя прикрепить: подходят ${Object.keys(ASSET_MIME).join(' ')}`,
        ),
        false,
      );
      return;
    }

    callback(null, true);
  },
};

export const landingMulterConfig: MulterOptions = {
  storage: diskStorageIn(PROMO_UPLOAD_DIR),
  limits: { fileSize: LANDING_MAX_ZIP_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (
      extname(decodeMultipartName(file.originalname)).toLowerCase() !== '.zip'
    ) {
      callback(
        new BadRequestException('Релиз лендинга загружается как .zip'),
        false,
      );
      return;
    }

    callback(null, true);
  },
};
