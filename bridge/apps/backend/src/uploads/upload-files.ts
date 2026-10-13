import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { diskStorage, StorageEngine } from 'multer';

export const UPLOAD_ROOT = join(process.cwd(), 'uploads');

export function ensureUploadDir(sub?: string): string {
  const dir = sub ? join(UPLOAD_ROOT, sub) : UPLOAD_ROOT;
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Busboy decodes multipart headers (incl. the filename) as latin1, but
// browsers send them UTF-8-encoded, so non-Latin1 names (e.g. Cyrillic)
// come through mangled unless re-decoded here.
export function decodeMultipartName(name: string): string {
  return Buffer.from(name, 'latin1').toString('utf8');
}

export function diskStorageIn(dir: string): StorageEngine {
  return diskStorage({
    destination: dir,
    filename: (_req, file, callback) => {
      file.originalname = decodeMultipartName(file.originalname);
      callback(
        null,
        `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
      );
    },
  });
}
