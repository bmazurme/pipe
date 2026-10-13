import type { Readable } from 'stream';

// Where uploaded files live. bridge used to write them straight to a directory of its own container
// (so a lost board meant lost files); now that is one driver among two, chosen by STORAGE_DRIVER.
// Keys are the names bridge already stores in the database — `<uuid>.zip` for Storage, `chat/<uuid>.png`
// for chat attachments — so a bucket that mirrors the old directory needs no migration of the rows.
export interface FileStore {
  readonly driver: 'local' | 's3';

  // A file multer wrote to the staging directory. Local: it is already where it belongs (a no-op);
  // S3: uploaded, and the staging copy removed — also when the upload fails.
  adopt(key: string, stagedPath: string): Promise<void>;

  put(key: string, bytes: Buffer): Promise<void>;

  // null when there is no such file.
  stat(key: string): Promise<{ size: number } | null>;

  openRead(key: string): Promise<Readable>;

  readBytes(key: string): Promise<Buffer>;

  // Removing what is not there is not an error.
  remove(key: string): Promise<void>;

  // An absolute path when the bytes are a plain file on this machine (lets Express use its own
  // sendFile/download with ranges and caching); null for a remote store.
  localPath(key: string): string | null;
}

export const FILE_STORE = Symbol('FILE_STORE');

export class FileMissingError extends Error {
  constructor(key: string) {
    super(`File ${key} is missing`);
    this.name = 'FileMissingError';
  }
}
