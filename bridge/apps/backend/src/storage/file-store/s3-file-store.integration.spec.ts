import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { FileMissingError } from './file-store';
import { S3FileStore } from './s3-file-store';

// Against a real S3 (Garage): runs only when S3_TEST_ENDPOINT is set, with a throwaway bucket and key.
const endpoint = process.env.S3_TEST_ENDPOINT;
const suite = endpoint ? describe : describe.skip;

suite('S3FileStore against a real bucket', () => {
  const dead = 'http://127.0.0.1:1'; // nothing listens: the first endpoint is down
  const store = new S3FileStore({
    endpoints: [dead, endpoint ?? ''],
    region: 'garage',
    bucket: process.env.S3_TEST_BUCKET ?? '',
    accessKeyId: process.env.S3_TEST_KEY_ID ?? '',
    secretAccessKey: process.env.S3_TEST_SECRET ?? '',
  });
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 's3-int-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('adopts a staged file (and removes the staging copy), reads it back, stats and removes it, failing over a dead endpoint', async () => {
    const staged = join(dir, 'staged.bin');
    const payload = Buffer.alloc(6 * 1024 * 1024, 7); // above the multipart part size

    writeFileSync(staged, payload);
    await store.adopt('int/big.bin', staged);

    expect(await store.stat('int/big.bin')).toEqual({ size: payload.length });
    expect((await store.readBytes('int/big.bin')).equals(payload)).toBe(true);
    expect(store.localPath()).toBeNull();

    await store.remove('int/big.bin');
    expect(await store.stat('int/big.bin')).toBeNull();
    await expect(store.readBytes('int/big.bin')).rejects.toBeInstanceOf(
      FileMissingError,
    );
    await store.remove('int/big.bin'); // removing twice is fine
  }, 60000);

  it('puts small bytes and keeps keys with slashes and non-ASCII names intact', async () => {
    await store.put('int/chat/файл.txt', Buffer.from('привет'));
    expect((await store.readBytes('int/chat/файл.txt')).toString()).toBe(
      'привет',
    );
    await store.remove('int/chat/файл.txt');
  }, 30000);
});
