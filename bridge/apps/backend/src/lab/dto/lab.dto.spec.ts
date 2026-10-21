import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SaveLabScheduleDto, StartLabRunDto } from './lab.dto';

const errorsFor = async (body: Record<string, unknown>) =>
  (
    await validate(
      plainToInstance(StartLabRunDto, {
        projectId: 1,
        task: 'Fix the test',
        model: 'sonnet',
        ...body,
      }),
    )
  ).map((error) => error.property);

describe('StartLabRunDto: the branch of a run', () => {
  it('takes no branch, or a well-formed one', async () => {
    expect(await errorsFor({})).toEqual([]);
    expect(await errorsFor({ baseBranch: ' release/1.4 ' })).toEqual([]);
  });

  it('rejects a malformed branch name', async () => {
    expect(await errorsFor({ baseBranch: 'a b' })).toEqual(['baseBranch']);
    expect(await errorsFor({ baseBranch: 'x~1' })).toEqual(['baseBranch']);
    expect(await errorsFor({ baseBranch: 'x'.repeat(101) })).toEqual([
      'baseBranch',
    ]);
  });
});

describe('SaveLabScheduleDto: weekdays', () => {
  const scheduleErrors = async (body: Record<string, unknown>) =>
    (
      await validate(
        plainToInstance(SaveLabScheduleDto, {
          projectId: 1,
          name: 'Будни',
          enabled: true,
          hour: 2,
          minute: 0,
          timezone: 'Europe/Moscow',
          model: 'sonnet',
          task: 'Обновить зависимости',
          ...body,
        }),
      )
    ).map((error) => error.property);

  it('takes no weekdays, null, or ISO weekdays 1–7', async () => {
    expect(await scheduleErrors({})).toEqual([]);
    expect(await scheduleErrors({ weekdays: null })).toEqual([]);
    expect(await scheduleErrors({ weekdays: [1, 2, 3, 4, 5] })).toEqual([]);
  });

  it('rejects days outside 1–7, repeats and non-arrays', async () => {
    expect(await scheduleErrors({ weekdays: [0] })).toEqual(['weekdays']);
    expect(await scheduleErrors({ weekdays: [8] })).toEqual(['weekdays']);
    expect(await scheduleErrors({ weekdays: [1, 1] })).toEqual(['weekdays']);
    expect(await scheduleErrors({ weekdays: 1 })).toEqual(['weekdays']);
  });
});
