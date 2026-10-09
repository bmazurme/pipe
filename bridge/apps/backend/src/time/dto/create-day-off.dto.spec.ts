import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateDayOffDto } from './create-day-off.dto';

const errorsFor = (date: string) =>
  validate(plainToInstance(CreateDayOffDto, { date }));

describe('CreateDayOffDto date', () => {
  it.each(['2025-01-31', '2024-02-29', '2026-12-31'])(
    'accepts the real date %s',
    async (date) => {
      expect(await errorsFor(date)).toEqual([]);
    },
  );

  it.each([
    '2025-02-31',
    '2025-13-45',
    '2025-04-31',
    '2023-02-29',
    '2025-00-10',
  ])(
    'rejects the impossible date %s, which used to reach Postgres as a 500',
    async (date) => {
      const errors = await errorsFor(date);

      expect(errors.some((error) => error.property === 'date')).toBe(true);
    },
  );

  it.each(['2025-1-1', '25-01-01', 'tomorrow', '2025/01/01'])(
    'still rejects the wrong format %s',
    async (date) => {
      expect((await errorsFor(date)).length).toBeGreaterThan(0);
    },
  );
});
