import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { AppLogService, parseRetentionDays } from './app-log.service';
import { AppLog } from './entities/app-log.entity';

const DAY = 24 * 60 * 60 * 1000;

describe('parseRetentionDays', () => {
  it('uses 30 when unset and the value when valid', () => {
    const logger = { warn: jest.fn() };

    expect(parseRetentionDays(undefined, logger)).toBe(30);
    expect(parseRetentionDays('7', logger)).toBe(7);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each(['1w', '0', '-3', '1.5', '"7"'])(
    'falls back to 30 and warns for %s',
    (raw) => {
      const logger = { warn: jest.fn() };

      expect(parseRetentionDays(raw, logger)).toBe(30);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('LOG_RETENTION_DAYS'),
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(raw));
    },
  );
});

describe('AppLogService.prune', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function makeService(deleteMock: jest.Mock, days?: string) {
    const config = new ConfigService(days ? { LOG_RETENTION_DAYS: days } : {});

    return new AppLogService(
      { delete: deleteMock } as unknown as Repository<AppLog>,
      config,
    );
  }

  it('deletes rows older than the retention window', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-31T04:00:00Z'));
    const del = jest.fn().mockResolvedValue({ affected: 2 });

    await makeService(del, '7').prune();

    expect(del).toHaveBeenCalledTimes(1);
    const where = del.mock.calls[0][0] as {
      createdAt: { value: Date };
    };

    expect(where.createdAt.value.getTime()).toBe(
      new Date('2026-01-31T04:00:00Z').getTime() - 7 * DAY,
    );
  });

  it('logs a failed delete and does not rethrow', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const del = jest.fn().mockRejectedValue(new Error('db down'));

    await expect(makeService(del).prune()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });
});
