import { StoredFile } from '../storage/entities/stored-file.entity';
import { Job } from './entities/job.entity';
import { WorkerService } from './worker.service';

// A recording stand-in for the query builder: every condition is kept as
// `[sql, parameters]`, and the NOT EXISTS callback is run against a fake sub-query.
function setup(result: Partial<StoredFile>[] = []) {
  const conditions: Array<[string, Record<string, unknown> | undefined]> = [];
  const subQuery = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getQuery: jest.fn().mockReturnValue('(SELECT 1 FROM jobs j WHERE ...)'),
  };
  const builder = {
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(result),
  };
  const record = (condition: unknown, params?: Record<string, unknown>) => {
    const sql =
      typeof condition === 'function'
        ? (condition as (qb: unknown) => string)({
            subQuery: () => subQuery,
          })
        : (condition as string);
    conditions.push([sql, params]);
    return builder;
  };
  builder.where.mockImplementation(record);
  builder.andWhere.mockImplementation(record);

  const manager = { createQueryBuilder: jest.fn().mockReturnValue(builder) };
  const service = new WorkerService(
    { manager } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, manager, conditions, subQuery, builder };
}

const paramsOf = (conditions: Array<[string, unknown]>) =>
  Object.assign(
    {},
    ...conditions.map(([, params]) => params as Record<string, unknown>),
  ) as Record<string, unknown>;

describe('WorkerService.findUnstartedIssueParcels', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-10-10')));
  afterEach(() => jest.useRealTimers());

  it('selects only unencrypted outbound issue parcels of the account', async () => {
    const { service, manager, conditions } = setup([{ id: 4 }]);
    const since = new Date('2026-10-01T00:00:00Z');

    const parcels = await service.findUnstartedIssueParcels(3, since, 10);

    expect(parcels).toEqual([{ id: 4 }]);
    expect(manager.createQueryBuilder).toHaveBeenCalledWith(StoredFile, 'f');
    const params = paramsOf(conditions);
    expect(params).toMatchObject({
      userId: 3,
      since,
      channel: 'issue',
      direction: 'outbound',
      encrypted: '%.enc',
    });
    expect(conditions.map(([sql]) => sql)).toContain(
      'f.originalName NOT LIKE :encrypted',
    );
  });

  it('leaves out a parcel that is too new', async () => {
    const { service, conditions } = setup();

    await service.findUnstartedIssueParcels(3, new Date(0), 10);

    expect(paramsOf(conditions).cutoff).toEqual(
      new Date(Date.now() - 10_000),
    );
    expect(conditions.map(([sql]) => sql)).toContain(
      'f.createdAt < :cutoff',
    );
  });

  it('leaves out a parcel that already has a job', async () => {
    const { service, conditions, subQuery } = setup();

    await service.findUnstartedIssueParcels(3, new Date(0), 10);

    expect(subQuery.from).toHaveBeenCalledWith(Job, 'j');
    expect(subQuery.where).toHaveBeenCalledWith('j.sourceFileId = f.id');
    expect(conditions.map(([sql]) => sql)).toContain(
      'NOT EXISTS (SELECT 1 FROM jobs j WHERE ...)',
    );
  });

  it('skips task keys with the excluded prefix only when one is given', async () => {
    const withPrefix = setup();
    await withPrefix.service.findUnstartedIssueParcels(
      3,
      new Date(0),
      10,
      'improve:',
    );
    expect(withPrefix.conditions.map(([sql]) => sql)).toContain(
      'f.taskKey NOT LIKE :excludedTasks',
    );
    expect(paramsOf(withPrefix.conditions).excludedTasks).toBe('improve:%');

    const without = setup();
    await without.service.findUnstartedIssueParcels(3, new Date(0), 10);
    expect(without.conditions.map(([sql]) => sql)).not.toContain(
      'f.taskKey NOT LIKE :excludedTasks',
    );
  });
});
