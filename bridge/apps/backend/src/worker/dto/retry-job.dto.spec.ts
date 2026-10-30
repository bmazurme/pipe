import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RetryJobDto } from './retry-job.dto';

const errorsFor = (notBefore?: unknown) =>
  validate(
    plainToInstance(RetryJobDto, notBefore === undefined ? {} : { notBefore }),
  );
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('RetryJobDto', () => {
  it('accepts no notBefore', async () => {
    expect(await errorsFor()).toHaveLength(0);
  });

  it('accepts a time within the next 7 days', async () => {
    expect(await errorsFor(inMs(3_600_000))).toHaveLength(0);
    expect(await errorsFor(inMs(6.9 * 86_400_000))).toHaveLength(0);
  });

  it.each([
    ['a past time', () => inMs(-60_000)],
    ['a time over 7 days ahead', () => inMs(8 * 86_400_000)],
    ['garbage', () => 'soon'],
  ])('rejects %s', async (_name, make) => {
    const errors = await errorsFor(make());
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('notBefore');
  });
});

describe('RetryJobDto overrides', () => {
  const check = (body: object) => validate(plainToInstance(RetryJobDto, body));

  it('accepts a known model and positive credential ids', async () => {
    expect(await check({ model: 'opus', claudeCredentialId: 3 })).toHaveLength(
      0,
    );
    expect(
      await check({ model: 'deepseek', providerCredentialId: 1 }),
    ).toHaveLength(0);
  });

  it('rejects an unknown model', async () => {
    const errors = await check({ model: 'gpt-9' });
    expect(errors.map((e) => e.property)).toEqual(['model']);
  });

  it.each([0, -1, 1.5])('rejects credential id %s', async (id) => {
    expect(await check({ claudeCredentialId: id })).toHaveLength(1);
    expect(await check({ providerCredentialId: id })).toHaveLength(1);
  });

  it('accepts a time limit from 5 minutes to 4 hours and rejects the rest', async () => {
    for (const timeoutSec of [300, 3600, 14400]) {
      expect(await check({ timeoutSec })).toHaveLength(0);
    }

    for (const timeoutSec of [0, 299, 14401, 1.5]) {
      expect((await check({ timeoutSec })).map((e) => e.property)).toEqual([
        'timeoutSec',
      ]);
    }
  });
});
