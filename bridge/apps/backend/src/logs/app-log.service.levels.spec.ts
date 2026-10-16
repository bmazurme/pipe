import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';

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
