import type { Response } from 'express';

import type { AppLogService } from './app-log.service';
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
