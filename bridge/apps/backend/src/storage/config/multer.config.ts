import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

import {
  diskStorageIn,
  ensureUploadDir,
  UPLOAD_ROOT,
} from '../../uploads/upload-files';

export const UPLOAD_DIR = UPLOAD_ROOT;
// Raised from 10 MB to fit zipped JS/TS projects (node_modules/.git/dist/etc.
// are stripped client-side before upload, but the remaining source tree can
// still land in the tens of MB for larger repos).
export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

// Total size one account may keep in Storage, in MB. STORAGE_QUOTA_MB: default 2048, 0 switches it off.
export const DEFAULT_STORAGE_QUOTA_MB = 2048;

export function storageQuotaBytes(): number {
  const raw = process.env.STORAGE_QUOTA_MB;
  const mb =
    raw === undefined || raw.trim() === ''
      ? DEFAULT_STORAGE_QUOTA_MB
      : Number(raw);

  if (!Number.isFinite(mb) || mb <= 0) {
    return 0;
  }

  return Math.floor(mb * 1024 * 1024);
}

ensureUploadDir();

export const multerConfig: MulterOptions = {
  storage: diskStorageIn(UPLOAD_DIR),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
};
