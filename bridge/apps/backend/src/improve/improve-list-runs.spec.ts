import {
  BadRequestException,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';

import { getMetadataArgsStorage } from 'typeorm';

import { ImproveRun } from './entities/improve-run.entity';
import { ImproveService } from './improve.service';

describe('ImproveService.listRuns limit', () => {
  const find = jest.fn().mockResolvedValue([]);
  const service = new ImproveService(
    { find } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => find.mockClear());

  it('defaults to 50', async () => {
    await service.listRuns();

    expect(find).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('clamps 0 to 1', async () => {
    await service.listRuns(0);

    expect(find).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
  });

  it('clamps 1000 to 200', async () => {
    await service.listRuns(1000);

    expect(find).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
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
    const service = new ImproveService(
      { findOne, update: jest.fn(), save: jest.fn() } as never,
      { send: jest.fn() } as never,
      { send: jest.fn() } as never,
      { send: jest.fn() } as never,
      { send: jest.fn() } as never,
      { send: jest.fn() } as never,
      { send: jest.fn() } as never,
      { send: jest.fn() } as never,
      { send: jest.fn() } as never,
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
