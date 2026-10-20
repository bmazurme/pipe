import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateJobDto } from './create-job.dto';

const errorsFor = (notBefore?: unknown) =>
  validate(
    plainToInstance(CreateJobDto, {
      sourceFileId: 1,
      model: 'sonnet',
      ...(notBefore === undefined ? {} : { notBefore }),
    }),
  );
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('CreateJobDto model', () => {
  const modelErrors = (model: unknown) =>
    validate(plainToInstance(CreateJobDto, { sourceFileId: 1, model }));

  it('accepts haiku next to the other models, and refuses one it does not know', async () => {
    for (const model of [
      'sonnet',
      'opus',
      'haiku',
      'gpt',
      'deepseek',
      'qwen',
    ]) {
      expect({ model, errors: await modelErrors(model) }).toEqual({
        model,
        errors: [],
      });
    }
    expect((await modelErrors('fable')).length).toBeGreaterThan(0);
  });
});

describe('CreateJobDto notBefore', () => {
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
  ])('rejects %s', async (_name, make) => {
    const errors = await errorsFor(make());
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('notBefore');
  });
});
