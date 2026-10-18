import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Response } from 'express';

import type { AppLogService } from './app-log.service';
import { LogsQueryDto } from './dto/logs-query.dto';
import { LogsController } from './logs.controller';

describe('LogsController.export', () => {
  const row = (event: string, meta: string | null) => ({
    createdAt: new Date('2026-01-01T00:00:00Z'),
    level: 'info',
    source: 'test',
    event,
    message: 'msg',
    meta,
  });

  it('emits a line without meta for a row with unparseable meta', async () => {
    const service = {
      exportRows: jest
        .fn()
        .mockResolvedValue([
          row('good', '{"a":1}'),
          row('bad', 'not json'),
          row('none', null),
        ]),
    } as unknown as AppLogService;
    const response = { setHeader: jest.fn(), send: jest.fn() };
    const controller = new LogsController(service);

    await controller.export({}, response as unknown as Response);

    const body = response.send.mock.calls[0][0] as string;
    const lines = body
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines).toHaveLength(3);
    expect(lines[0].meta).toEqual({ a: 1 });
    expect(lines[1]).not.toHaveProperty('meta');
    expect(lines[1].event).toBe('bad');
    expect(lines[2]).not.toHaveProperty('meta');
  });
});

describe('LogsController.list', () => {
  it('maps problems to warn and error levels', () => {
    const list = jest.fn().mockResolvedValue([]);
    const controller = new LogsController({ list } as unknown as AppLogService);

    void controller.list({ problems: true, q: 'x', days: 7 });

    expect(list).toHaveBeenCalledWith({
      q: 'x',
      days: 7,
      levels: ['warn', 'error'],
    });
  });
});

describe('LogsQueryDto', () => {
  const check = (raw: Record<string, unknown>) =>
    validate(plainToInstance(LogsQueryDto, raw));

  it('accepts q and problems from a query string', async () => {
    const dto = plainToInstance(LogsQueryDto, { q: 'a', problems: 'true' });

    expect(dto.problems).toBe(true);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects q over 100 characters', async () => {
    expect(await check({ q: 'x'.repeat(101) })).toHaveLength(1);
    expect(await check({ q: 'x'.repeat(100) })).toHaveLength(0);
  });

  it('rejects a non-boolean problems', async () => {
    expect(await check({ problems: 'maybe' })).toHaveLength(1);
  });
});
