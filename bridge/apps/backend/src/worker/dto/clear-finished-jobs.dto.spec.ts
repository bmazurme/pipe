import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ClearFinishedJobsDto } from './clear-finished-jobs.dto';

const errorsFor = (query: Record<string, unknown>) =>
  validate(plainToInstance(ClearFinishedJobsDto, query));

describe('ClearFinishedJobsDto', () => {
  it.each(['1', '30', '365'])('accepts olderThanDays=%s', async (value) => {
    expect(await errorsFor({ olderThanDays: value })).toHaveLength(0);
  });

  it.each([
    ['missing', undefined],
    ['non-numeric', 'abc'],
    ['zero', '0'],
    ['over a year', '366'],
    ['fractional', '1.5'],
  ])('rejects %s olderThanDays', async (_name, value) => {
    const errors = await errorsFor(
      value === undefined ? {} : { olderThanDays: value },
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('olderThanDays');
  });
});
