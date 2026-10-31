import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { AppLogService, RecordInput } from './app-log.service';
import { AppLog } from './entities/app-log.entity';
import { sanitizeMeta } from './redact';

describe('AppLogService.record', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeService(save: jest.Mock) {
    return new AppLogService(
      { save } as unknown as Repository<AppLog>,
      new ConfigService({}),
    );
  }

  function input(overrides: Partial<RecordInput> = {}): RecordInput {
    return {
      level: 'info',
      source: 'http',
      event: 'http.error',
      message: 'something happened',
      ...overrides,
    } as RecordInput;
  }

  function saved(save: jest.Mock): Record<string, unknown> {
    expect(save).toHaveBeenCalledTimes(1);

    return save.mock.calls[0][0] as Record<string, unknown>;
  }

  it('resolves and warns with the error message when save rejects', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const save = jest.fn().mockRejectedValue(new Error('db down'));

    await expect(makeService(save).record(input())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  it('warns with a stringified non-Error rejection', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const save = jest.fn().mockRejectedValue('plain failure');

    await expect(makeService(save).record(input())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('plain failure'));
  });

  it('stores a redacted message', async () => {
    const save = jest.fn().mockResolvedValue(undefined);

    await makeService(save).record(
      input({
        message:
          'x -----BEGIN PRIVATE KEY-----\nAAA\nBBB\n-----END PRIVATE KEY----- y',
      }),
    );

    const row = saved(save);

    expect(row.message).toBe('x [redacted-private-key] y');
    expect(row.message).not.toContain('AAA');
  });

  it('clips the message to 500 chars and the event to 64', async () => {
    const save = jest.fn().mockResolvedValue(undefined);

    await makeService(save).record(
      input({ message: 'm'.repeat(600), event: 'e'.repeat(100) }),
    );

    const row = saved(save);

    expect((row.message as string).length).toBe(500);
    expect((row.event as string).length).toBe(64);
  });

  it('stores meta as the sanitizeMeta string, or null when absent', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const service = makeService(save);
    const meta = { jobId: 5, ok: false };

    await service.record(input({ meta }));
    await service.record(input({ meta: undefined }));

    expect(save).toHaveBeenCalledTimes(2);
    expect((save.mock.calls[0][0] as { meta: unknown }).meta).toBe(
      sanitizeMeta(meta),
    );
    expect((save.mock.calls[0][0] as { meta: unknown }).meta).toBe(
      '{"jobId":5,"ok":false}',
    );
    expect((save.mock.calls[1][0] as { meta: unknown }).meta).toBeNull();
  });
});
