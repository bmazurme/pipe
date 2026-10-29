import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import {
  AppLogService,
  MAX_EXPORT_ROWS,
  SUMMARY_EVENTS,
} from './app-log.service';
import { AppLog } from './entities/app-log.entity';

function makeService(
  eventRows: number,
  counts: Array<{ level: string; source: string; count: string }>,
) {
  const find = jest.fn(({ take }: { take: number }) =>
    Promise.resolve(
      Array.from({ length: Math.min(eventRows, take) }, () => ({
        event: 'http.error',
        message: 'm',
        meta: null,
      })),
    ),
  );
  const builder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(counts),
  };
  const service = new AppLogService(
    {
      find,
      createQueryBuilder: jest.fn(() => builder),
    } as unknown as Repository<AppLog>,
    new ConfigService(),
  );

  return { service, find, builder };
}

const ONE = [{ level: 'info', source: 'http', count: '3' }];

describe('AppLogService.summary', () => {
  it('selects only the needed columns and events', async () => {
    const { service, find } = makeService(3, ONE);

    await service.summary(7);

    const arg = find.mock.calls[0][0] as unknown as {
      select: string[];
      where: Record<string, { value?: unknown }>;
      take: number;
    };

    expect(arg.select).toEqual(['event', 'message', 'meta']);
    expect(Object.keys(arg.where).sort()).toEqual(['createdAt', 'event']);
    expect(arg.where.event.value).toEqual(SUMMARY_EVENTS);
    expect(arg.take).toBe(MAX_EXPORT_ROWS);
  });

  it('takes totals from the grouped counts, beyond the row cap', async () => {
    const { service, builder } = makeService(10, [
      { level: 'info', source: 'http', count: '25000' },
      { level: 'warn', source: 'telegram', count: '7' },
    ]);

    const summary = await service.summary(7);

    expect(builder.groupBy).toHaveBeenCalledWith('log.level');
    expect(summary.total).toBe(25_007);
    expect(summary.byLevel).toEqual({ info: 25_000, warn: 7 });
    expect(summary.truncated).toBe(false);
  });

  it('flags truncation only when the event query hits the cap', async () => {
    const { service } = makeService(MAX_EXPORT_ROWS + 5, ONE);

    expect((await service.summary(7)).truncated).toBe(true);
  });
});
