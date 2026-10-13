import { createFileStore } from './create-file-store';
import { LocalFileStore } from './local-file-store';
import { S3FileStore } from './s3-file-store';

const s3env = {
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'http://192.168.50.12:3900, http://192.168.50.13:3900',
  S3_BUCKET: 'bridge-uploads',
  S3_ACCESS_KEY_ID: 'GKabc',
  S3_SECRET_ACCESS_KEY: 'secret',
};

describe('createFileStore', () => {
  it("is the local directory unless told otherwise — today's behaviour", () => {
    expect(createFileStore({}, '/tmp/uploads')).toBeInstanceOf(LocalFileStore);
    expect(
      createFileStore({ STORAGE_DRIVER: ' LOCAL ' }, '/tmp/uploads'),
    ).toBeInstanceOf(LocalFileStore);
  });

  it('builds the S3 store from the S3_* values, accepting a list of endpoints', () => {
    const store = createFileStore(s3env, '/tmp/uploads');

    expect(store).toBeInstanceOf(S3FileStore);
    expect(store.driver).toBe('s3');
  });

  it('fails at startup naming every missing S3 value', () => {
    expect(() => createFileStore({ STORAGE_DRIVER: 's3' }, '/x')).toThrow(
      'STORAGE_DRIVER=s3 needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY',
    );
    expect(() => createFileStore({ ...s3env, S3_BUCKET: '' }, '/x')).toThrow(
      'needs S3_BUCKET',
    );
  });

  it('refuses a driver it does not know rather than guessing', () => {
    expect(() => createFileStore({ STORAGE_DRIVER: 'ftp' }, '/x')).toThrow(
      /must be "local" or "s3"/,
    );
  });
});
