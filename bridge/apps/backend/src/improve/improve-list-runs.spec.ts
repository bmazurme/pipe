import {
  BadRequestException,
  DefaultValuePipe,
  NotFoundException,
  ParseIntPipe,
} from '@nestjs/common';

import { getMetadataArgsStorage } from 'typeorm';

import { ImproveRun } from './entities/improve-run.entity';
import { ImprovePublishService } from './improve-publish.service';
import { ImproveService } from './improve.service';

describe('ImproveService.listRuns leaves out result', () => {
  const build = () => {
    const qb: Record<string, jest.Mock> = {};

    for (const name of ['select', 'addSelect', 'orderBy', 'limit']) {
      qb[name] = jest.fn().mockReturnValue(qb);
    }

    qb.getRawAndEntities = jest.fn().mockResolvedValue({
      entities: [{ id: 2 }, { id: 1 }],
      raw: [{ hasResult: true }, { hasResult: false }],
    });

    const repo = {
      metadata: {
        columns: ['id', 'result', 'baseline', 'note'].map((propertyName) => ({
          propertyName,
        })),
      },
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const service = new ImproveService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { qb, service };
  };

  it('selects every column but result and baseline, and adds hasResult', async () => {
    const { qb, service } = build();

    const rows = await service.listRuns();

    expect(qb.select).toHaveBeenCalledWith(['run.id', 'run.note']);
    expect(qb.addSelect).toHaveBeenCalledWith(
      'run.result IS NOT NULL',
      'hasResult',
    );
    expect(rows).toEqual([
      { id: 2, hasResult: true },
      { id: 1, hasResult: false },
    ]);
    expect(rows[0]).not.toHaveProperty('result');
  });

  it.each([
    [undefined, 50],
    [0, 1],
    [1000, 200],
  ])('limit %p becomes %p', async (input, expected) => {
    const { qb, service } = build();

    await service.listRuns(input);

    expect(qb.limit).toHaveBeenCalledWith(expected);
  });
});

describe('ImproveService.getRun', () => {
  const build = (found: unknown) => {
    const findOne = jest.fn().mockResolvedValue(found);
    const service = new ImproveService(
      { findOne } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { findOne, service };
  };

  it('returns the full run including result', async () => {
    const run = { id: 3, result: '{"items":[]}' };
    const { findOne, service } = build(run);

    await expect(service.getRun(3)).resolves.toBe(run);
    expect(findOne).toHaveBeenCalledWith({ where: { id: 3 } });
  });

  it('throws NotFoundException for an unknown id', async () => {
    const { service } = build(null);

    await expect(service.getRun(99)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('GET /improve/runs limit pipes', () => {
  const meta = { type: 'query', data: 'limit' } as const;
  const pipe = new ParseIntPipe();
  const fallback = new DefaultValuePipe(50);

  it.each(['abc', '1.5', '1e3', ''])('rejects %p with 400', async (value) => {
    await expect(pipe.transform(value, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('uses 50 when the parameter is omitted', async () => {
    const value = fallback.transform(undefined, meta);

    await expect(pipe.transform(value, meta)).resolves.toBe(50);
  });

  it('parses a numeric string', async () => {
    await expect(pipe.transform('7', meta)).resolves.toBe(7);
  });
});

describe('ImproveService list queries leave out baseline', () => {
  it('publish loads the baseline when the run came without it', async () => {
    const findOne = jest.fn().mockResolvedValue({ id: 1, baseline: '{}' });
    const service = new ImprovePublishService(
      { findOne, update: jest.fn(), save: jest.fn() } as never,
      {} as never,
      {} as never,
      { send: jest.fn() } as never,
      {} as never,
    );
    const run = { id: 1, userId: 1 } as never;

    jest
      .spyOn(service as never, 'finish')
      .mockResolvedValue(undefined as never);

    await service.publish(run, 5);

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true, baseline: true } }),
    );
  });
});

describe('ImproveRun.baseline column', () => {
  it('is not selected by default, so list queries never request it', () => {
    const column = getMetadataArgsStorage().columns.find(
      (c) => c.target === ImproveRun && c.propertyName === 'baseline',
    );

    expect(column?.options.select).toBe(false);
  });
});

describe('ImproveService.listIssues latest run', () => {
  it('queries only the newest run per issue, without result, and joins by issue', async () => {
    const qb: Record<string, jest.Mock> = {};

    for (const name of [
      'select',
      'distinctOn',
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
    ]) {
      qb[name] = jest.fn().mockReturnValue(qb);
    }

    qb.getMany = jest.fn().mockResolvedValue([
      { id: 9, issueNumber: 2, status: 'failed' },
      { id: 5, issueNumber: 1, status: 'pr_open' },
    ]);

    const repo = {
      metadata: {
        columns: ['id', 'issueNumber', 'result', 'baseline'].map(
          (propertyName) => ({ propertyName }),
        ),
      },
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const github = {
      isReady: () => true,
      listOpenIssues: jest
        .fn()
        .mockResolvedValue([{ number: 1 }, { number: 2 }, { number: 3 }]),
    };
    const service = new ImproveService(
      repo as never,
      github as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const requireConfigured = jest.spyOn(
      service as never as { requireConfigured: () => void },
      'requireConfigured',
    );

    requireConfigured.mockImplementation(() => undefined);

    const issues = await service.listIssues();

    expect(qb.select).toHaveBeenCalledWith(['run.id', 'run.issueNumber']);
    expect(qb.distinctOn).toHaveBeenCalledWith(['run.issueNumber']);
    expect(qb.addOrderBy).toHaveBeenCalledWith('run.id', 'DESC');
    expect(
      issues.map((i) => (i.run as { id: number } | null)?.id ?? null),
    ).toEqual([5, 9, null]);
  });
});
