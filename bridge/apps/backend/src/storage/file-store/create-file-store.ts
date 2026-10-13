import { LocalFileStore } from './local-file-store';
import type { FileStore } from './file-store';
import { S3FileStore } from './s3-file-store';

type Env = Record<string, string | undefined>;

// STORAGE_DRIVER=local (default) keeps today's behaviour exactly. STORAGE_DRIVER=s3 needs the S3_* values and
// fails at startup, with the names of the missing ones, rather than at the first upload.
export function createFileStore(env: Env, localRoot: string): FileStore {
  const driver = (env.STORAGE_DRIVER ?? 'local').trim().toLowerCase();

  if (driver === 'local') return new LocalFileStore(localRoot);

  if (driver !== 's3') {
    throw new Error(`STORAGE_DRIVER must be "local" or "s3", not "${driver}"`);
  }

  const endpoints = (env.S3_ENDPOINT ?? '')
    .split(',')
    .map((endpoint) => endpoint.trim())
    .filter(Boolean);
  const missing = [
    !endpoints.length && 'S3_ENDPOINT',
    !env.S3_BUCKET && 'S3_BUCKET',
    !env.S3_ACCESS_KEY_ID && 'S3_ACCESS_KEY_ID',
    !env.S3_SECRET_ACCESS_KEY && 'S3_SECRET_ACCESS_KEY',
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(`STORAGE_DRIVER=s3 needs ${missing.join(', ')}`);
  }

  return new S3FileStore({
    endpoints,
    region: env.S3_REGION || 'garage',
    bucket: env.S3_BUCKET as string,
    accessKeyId: env.S3_ACCESS_KEY_ID as string,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
  });
}
