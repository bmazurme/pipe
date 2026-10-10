import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { AppLogService, MAX_EXPORT_ROWS } from './app-log.service';
import { AppLog } from './entities/app-log.entity';

function makeService(total: number) {
  const all = Array.from({ length: total }, (_, i) => ({
    id: i + 1,
    level: 'info',
    source: 'http',
    event: 'http.ok',
    message: 'm',
    meta: null,
  })) as unknown as AppLog[];
  const find = jest.fn(
    ({ order, take }: { order: { id: 'ASC' | 'DESC' }; take: number }) => {
      const sorted = order.id === 'DESC' ? [...all].reverse() : [...all];

      return Promise.resolve(sorted.slice(0, take));
    },
  );
  const service = new AppLogService(
    { find } as unknown as Repository<AppLog>,
    new ConfigService(),
  );

  return service;
}

describe('AppLogService row cap', () => {
  it('keeps the newest rows, in ascending order, and flags truncation', async () => {
    const total = MAX_EXPORT_ROWS + 5;
    const service = makeService(total);

    const rows = await service.exportRows(7);

    expect(rows).toHaveLength(MAX_EXPORT_ROWS);
    expect(rows[0].id).toBe(6);
    expect(rows[rows.length - 1].id).toBe(total);

    const summary = await service.summary(7);

    expect(summary.total).toBe(MAX_EXPORT_ROWS);
    expect(summary.truncated).toBe(true);
  });

  it('does not flag truncation under the cap', async () => {
    const service = makeService(10);

    const summary = await service.summary(7);

    expect(summary.total).toBe(10);
    expect(summary.truncated).toBe(false);
  });
});
