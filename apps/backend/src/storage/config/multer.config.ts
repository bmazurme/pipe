import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const UPLOAD_DIR = join(process.cwd(), 'uploads');
// Raised from 10 MB to fit zipped JS/TS projects (node_modules/.git/dist/etc.
// are stripped client-side before upload, but the remaining source tree can
// still land in the tens of MB for larger repos).
export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

mkdirSync(UPLOAD_DIR, { recursive: true });

export const multerConfig: MulterOptions = {
  storage: diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
};
