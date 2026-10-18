import type { S3Client } from '@aws-sdk/client-s3';

import { BackupStatusService } from './backup-status.service';

const CONFIGURED_ENV = {
  BACKUP_S3_ENDPOINT: 'http://192.168.50.11:3900',
  BACKUP_S3_BUCKET: 'bridge-backups',
  BACKUP_S3_ACCESS_KEY_ID: 'key',
  BACKUP_S3_SECRET_ACCESS_KEY: 'secret',
};

function textBody(text: string) {
  return { Body: { transformToString: async () => text } };
}

// A fake client factory, the same way S3FileStore's tests stand in for a
// real S3Client — a real one needs a reachable Garage endpoint, this doesn't.
function fakeClientFactory(send: jest.Mock) {
  return () => ({ send }) as unknown as S3Client;
}

function setup(env: Record<string, string>, send: jest.Mock) {
  const config = { get: jest.fn((key: string) => env[key]) };
  const factory = jest.fn(fakeClientFactory(send));
  const service = new BackupStatusService(config as never, factory);

  return { service, factory };
}

describe('BackupStatusService.getStatus', () => {
  it('reports "not configured" when the backup S3 env vars are unset', async () => {
    const { service } = setup({}, jest.fn());

    await expect(service.getStatus()).resolves.toEqual({
      configured: false,
      lastBackupAt: null,
      rawBytes: null,
    });
  });

  it('parses LATEST and the snapshot size from meta.env', async () => {
    const send = jest.fn((command: { input: { Key: string } }) => {
      if (command.input.Key === 'LATEST') return textBody('20261012T030000Z');
      if (command.input.Key === 'snapshots/20261012T030000Z/meta.env') {
        return textBody('CREATED=20261012T030000Z\nRAW_BYTES=123456\n');
      }
      throw new Error(`NoSuchKey: ${command.input.Key}`);
    });

    const { service } = setup(CONFIGURED_ENV, send);
    const status = await service.getStatus();

    expect(status).toMatchObject({
      configured: true,
      lastBackupAt: '2026-10-12T03:00:00.000Z',
      rawBytes: 123456,
    });
  });

  it('still reports the timestamp when meta.env is missing', async () => {
    const send = jest.fn((command: { input: { Key: string } }) => {
      if (command.input.Key === 'LATEST') return textBody('20261012T030000Z');
      throw new Error(`NoSuchKey: ${command.input.Key}`);
    });

    const { service } = setup(CONFIGURED_ENV, send);
    const status = await service.getStatus();

    expect(status).toMatchObject({
      configured: true,
      lastBackupAt: '2026-10-12T03:00:00.000Z',
      rawBytes: null,
    });
  });

  it('refuses an unrecognized LATEST shape instead of returning a bogus date', async () => {
    const send = jest.fn().mockResolvedValue(textBody('not-a-timestamp'));

    const { service } = setup(CONFIGURED_ENV, send);
    const status = await service.getStatus();

    expect(status).toMatchObject({ configured: true, lastBackupAt: null });
    expect(status.error).toContain('unrecognized shape');
  });

  it('turns a bucket-unreachable failure into an error result, not a throw', async () => {
    const send = jest.fn().mockRejectedValue(new Error('NetworkingError'));

    const { service } = setup(CONFIGURED_ENV, send);
    const status = await service.getStatus();

    expect(status).toMatchObject({
      configured: true,
      lastBackupAt: null,
      rawBytes: null,
    });
    expect(status.error).toContain('NetworkingError');
  });
});

describe('BackupStatusService caching', () => {
  const happySend = () =>
    jest.fn((command: { input: { Key: string } }) =>
      command.input.Key === 'LATEST'
        ? textBody('20261012T030000Z')
        : textBody('RAW_BYTES=1\n'),
    );

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reuses the client and the result within 60 s', async () => {
    const send = happySend();
    const { service, factory } = setup(CONFIGURED_ENV, send);

    const first = await service.getStatus();
    const second = await service.getStatus();

    expect(second).toEqual(first);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('fetches fresh data after 60 s with the same client', async () => {
    const send = happySend();
    const { service, factory } = setup(CONFIGURED_ENV, send);

    await service.getStatus();
    jest.advanceTimersByTime(60_001);
    await service.getStatus();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('caches an error result too', async () => {
    const send = jest.fn().mockRejectedValue(new Error('NetworkingError'));
    const { service } = setup(CONFIGURED_ENV, send);

    await service.getStatus();
    await service.getStatus();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('makes no S3 call when not configured', async () => {
    const send = jest.fn();
    const { service, factory } = setup({}, send);

    await service.getStatus();
    await service.getStatus();

    expect(factory).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('destroys the client on module destroy', async () => {
    const destroy = jest.fn();
    const send = happySend();
    const config = {
      get: jest.fn((key: string) => CONFIGURED_ENV[key as never]),
    };
    const service = new BackupStatusService(
      config as never,
      () => ({ send, destroy }) as unknown as S3Client,
    );

    await service.getStatus();
    service.onModuleDestroy();

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
