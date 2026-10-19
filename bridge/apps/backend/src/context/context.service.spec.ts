import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { ContextService } from './context.service';
import { ImproveSchedule } from '../improve/entities/improve-schedule.entity';
import { Job } from '../worker/entities/job.entity';
import { Context } from './entities/context.entity';

type MockRepository = Partial<Record<keyof Repository<Context>, jest.Mock>>;

describe('ContextService', () => {
  let service: ContextService;
  let repository: MockRepository;
  let scheduleRepository: MockRepository;
  let jobQuery: { getRawMany: jest.Mock };

  beforeEach(async () => {
    repository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((entity) => entity),
      save: jest.fn((entity) => Promise.resolve(entity)),
      delete: jest.fn(),
    };

    scheduleRepository = { find: jest.fn().mockResolvedValue([]) };
    jobQuery = { getRawMany: jest.fn().mockResolvedValue([]) };
    const jobRepository = {
      createQueryBuilder: jest.fn(() => {
        const chain: Record<string, jest.Mock> = {};
        for (const m of [
          'select',
          'addSelect',
          'where',
          'andWhere',
          'groupBy',
        ]) {
          chain[m] = jest.fn(() => chain);
        }
        chain.getRawMany = jobQuery.getRawMany;
        return chain;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextService,
        { provide: getRepositoryToken(Context), useValue: repository },
        {
          provide: getRepositoryToken(ImproveSchedule),
          useValue: scheduleRepository,
        },
        { provide: getRepositoryToken(Job), useValue: jobRepository },
      ],
    }).compile();

    service = module.get(ContextService);
  });

  it('lists only the owner’s contexts, by name, without reading their text', async () => {
    repository.find!.mockResolvedValue([]);

    await service.findAllByUser(7);

    const query = repository.find!.mock.calls[0][0] as {
      select: string[];
      where: unknown;
      order: unknown;
    };

    expect(query.where).toEqual({ userId: 7 });
    expect(query.order).toEqual({ name: 'ASC' });
    // Not selecting `content` is the point: no decrypting, no 20 000 chars per row.
    expect(query.select).toContain('contentLength');
    expect(query.select).not.toContain('content');
  });

  it('records the text length when creating and updating', async () => {
    repository.findOne!.mockResolvedValue(null);
    const created = await service.create(7, { name: 'N', content: 'abcde' });
    expect(created.contentLength).toBe(5);

    repository.findOne!.mockResolvedValue({
      id: 1,
      userId: 7,
      name: 'N',
      content: 'abcde',
      contentLength: 5,
    });
    const updated = await service.update(1, 7, { content: 'abcdefgh' });
    expect(updated.contentLength).toBe(8);
  });

  it('will not hand out someone else’s context', async () => {
    repository.findOne!.mockResolvedValue(null);

    await expect(service.findOwned(5, 7)).rejects.toThrow(NotFoundException);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: 5, userId: 7 },
    });
  });

  it('creates a context with a trimmed name', async () => {
    repository.findOne!.mockResolvedValue(null);

    const created = await service.create(7, {
      name: '  Project notes ',
      content: 'Use pnpm.',
    });

    expect(created).toMatchObject({
      userId: 7,
      name: 'Project notes',
      content: 'Use pnpm.',
    });
  });

  it('rejects a duplicate name for the same user', async () => {
    repository.findOne!.mockResolvedValue({ id: 1 });

    await expect(
      service.create(7, { name: 'Project notes', content: 'x' }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('updates the content without a name clash check when the name is unchanged', async () => {
    const stored = { id: 1, userId: 7, name: 'Notes', content: 'old' };
    repository.findOne!.mockResolvedValue(stored);

    const updated = await service.update(1, 7, {
      name: 'Notes',
      content: 'new',
    });

    expect(updated.content).toBe('new');
    expect(repository.findOne).toHaveBeenCalledTimes(1);
  });

  it('refuses a rename onto a name already in use', async () => {
    repository
      .findOne!.mockResolvedValueOnce({
        id: 1,
        userId: 7,
        name: 'Notes',
        content: 'x',
      })
      .mockResolvedValueOnce({ id: 2 });

    await expect(service.update(1, 7, { name: 'Other' })).rejects.toThrow(
      BadRequestException,
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  describe('unique-index race on save', () => {
    const uniqueViolation = Object.assign(new Error('duplicate key'), {
      driverError: { code: '23505' },
    });

    it('maps a 23505 on create to the duplicate-name 400', async () => {
      repository.findOne!.mockResolvedValue(null);
      repository.save!.mockRejectedValue(uniqueViolation);

      const result = service.create(7, { name: ' Notes ', content: 'x' });

      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toThrow(
        'A context named "Notes" already exists',
      );
    });

    it('maps a 23505 on update to the duplicate-name 400', async () => {
      repository
        .findOne!.mockResolvedValueOnce({
          id: 1,
          userId: 7,
          name: 'Notes',
          content: 'x',
        })
        .mockResolvedValueOnce(null);
      repository.save!.mockRejectedValue(uniqueViolation);

      const result = service.update(1, 7, { name: 'Other' });

      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toThrow(
        'A context named "Other" already exists',
      );
    });

    it('rethrows any other save error unchanged', async () => {
      const other = Object.assign(new Error('boom'), {
        driverError: { code: '57014' },
      });
      repository.findOne!.mockResolvedValue(null);
      repository.save!.mockRejectedValue(other);

      await expect(
        service.create(7, { name: 'Notes', content: 'x' }),
      ).rejects.toBe(other);
    });
  });

  it('deletes an owned context and 404s on someone else’s', async () => {
    repository.findOne!.mockResolvedValueOnce({ id: 1, userId: 7 });
    await service.delete(1, 7);
    expect(repository.delete).toHaveBeenCalledWith(1);

    repository.findOne!.mockResolvedValueOnce(null);
    await expect(service.delete(2, 7)).rejects.toThrow(NotFoundException);
  });
});

describe('ContextService usage info', () => {
  const build = async (
    contexts: unknown[],
    schedules: unknown[],
    jobRows: unknown[],
  ) => {
    const schedulesFind = jest.fn().mockResolvedValue(schedules);
    const chain: Record<string, jest.Mock> = {};
    for (const m of ['select', 'addSelect', 'where', 'andWhere', 'groupBy']) {
      chain[m] = jest.fn(() => chain);
    }
    chain.getRawMany = jest.fn().mockResolvedValue(jobRows);
    const module = await Test.createTestingModule({
      providers: [
        ContextService,
        {
          provide: getRepositoryToken(Context),
          useValue: { find: jest.fn().mockResolvedValue(contexts) },
        },
        {
          provide: getRepositoryToken(ImproveSchedule),
          useValue: { find: schedulesFind },
        },
        {
          provide: getRepositoryToken(Job),
          useValue: { createQueryBuilder: jest.fn(() => chain) },
        },
      ],
    }).compile();

    return { service: module.get(ContextService), schedulesFind, chain };
  };

  it('attaches schedules and the last job time per context, null when unused', async () => {
    const { service, schedulesFind, chain } = await build(
      [
        { id: 1, name: 'Notes' },
        { id: 2, name: 'Idle' },
      ],
      [{ id: 10, name: 'Nightly', contextId: 1 }],
      [{ contextName: 'Notes', lastUsedAt: '2026-10-01T00:00:00.000Z' }],
    );

    const result = await service.findAllByUser(7);

    expect(result[0].schedules).toEqual([{ id: 10, name: 'Nightly' }]);
    expect(result[0].lastUsedAt).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(result[1].schedules).toEqual([]);
    expect(result[1].lastUsedAt).toBeNull();
    // Scoped to the caller, for both schedules and jobs.
    expect(schedulesFind.mock.calls[0][0].where.userId).toBe(7);
    expect(chain.where).toHaveBeenCalledWith('job.userId = :userId', {
      userId: 7,
    });
  });
});
