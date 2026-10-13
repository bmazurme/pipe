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

ensureUploadDir();

export const multerConfig: MulterOptions = {
  storage: diskStorageIn(UPLOAD_DIR),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
};
