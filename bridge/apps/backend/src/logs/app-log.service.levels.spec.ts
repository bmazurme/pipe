import { ConfigService } from '@nestjs/config';
import { ILike, In, Repository } from 'typeorm';

import { AppLogService } from './app-log.service';
import { AppLog } from './entities/app-log.entity';

describe('AppLogService.list levels', () => {
  const setup = () => {
    const find = jest.fn().mockResolvedValue([]);
    const service = new AppLogService(
      { find } as unknown as Repository<AppLog>,
      new ConfigService(),
    );

    return { service, find };
  };

  it('asks the repository for warn and error rows only', async () => {
    const { service, find } = setup();

    await service.list({ levels: ['warn', 'error'], limit: 300 });

    const { where, take } = find.mock.calls[0][0];

    expect(where.level).toEqual(In(['warn', 'error']));
    expect(take).toBe(300);
  });

  it('adds no level condition without levels', async () => {
    const { service, find } = setup();

    await service.list({});

    expect(find.mock.calls[0][0].where).not.toHaveProperty('level');
  });
});

describe('AppLogService.list text search', () => {
  const run = async (q?: string) => {
    const find = jest.fn().mockResolvedValue([]);
    const service = new AppLogService(
      { find } as unknown as Repository<AppLog>,
      new ConfigService(),
    );

    await service.list({ q });

    return find.mock.calls[0][0].where;
  };

  it('matches the message case-insensitively as a substring', async () => {
    expect((await run('SIGTERM')).message).toEqual(ILike('%SIGTERM%'));
  });

  it('treats %, _ and backslash literally', async () => {
    expect((await run('50%_a\\b')).message).toEqual(ILike('%50\\%\\_a\\\\b%'));
  });

  it('adds no message condition without q', async () => {
    expect(await run()).not.toHaveProperty('message');
  });
});
