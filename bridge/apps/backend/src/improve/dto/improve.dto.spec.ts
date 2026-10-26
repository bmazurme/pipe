import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ALL_CATEGORIES } from '../analysis';
import {
  CreateImproveIssueDto,
  CreateIssuesDto,
  SaveScheduleDto,
  StartAnalysisDto,
  StartItemsDto,
  StartManyDto,
} from './improve.dto';

const range = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => i + from);

async function errorsFor(
  cls: new () => object,
  plain: Record<string, unknown>,
) {
  return validate(plainToInstance(cls, plain));
}

describe('Improve DTO array caps', () => {
  it('StartManyDto accepts 20 issue numbers and rejects 21', async () => {
    expect(
      await errorsFor(StartManyDto, { issueNumbers: range(20), model: 'm' }),
    ).toHaveLength(0);
    const errors = await errorsFor(StartManyDto, {
      issueNumbers: range(21),
      model: 'm',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('arrayMaxSize');
  });

  it.each([StartItemsDto, CreateIssuesDto])(
    '%p accepts 50 indices and rejects 51',
    async (cls) => {
      const body = { model: 'm' };
      expect(
        await errorsFor(cls, { ...body, indices: range(50, 0) }),
      ).toHaveLength(0);
      const errors = await errorsFor(cls, { ...body, indices: range(51, 0) });
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toHaveProperty('arrayMaxSize');
    },
  );

  it.each([StartAnalysisDto, SaveScheduleDto])(
    '%p caps categories at the number of categories',
    async (cls) => {
      const base = {
        model: 'm',
        name: 'n',
        enabled: true,
        hour: 1,
        minute: 1,
        timezone: 'UTC',
        count: 1,
      };
      expect(
        await errorsFor(cls, { ...base, categories: [...ALL_CATEGORIES] }),
      ).toHaveLength(0);
      const errors = await errorsFor(cls, {
        ...base,
        categories: [...ALL_CATEGORIES, 'extra'],
      });
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toHaveProperty('arrayMaxSize');
    },
  );
});

describe('CreateImproveIssueDto', () => {
  it('accepts a title and trims it', async () => {
    const dto = plainToInstance(CreateImproveIssueDto, { title: '  Idea  ' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.title).toBe('Idea');
  });

  it('rejects an empty or blank title', async () => {
    expect(
      await errorsFor(CreateImproveIssueDto, { title: '' }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor(CreateImproveIssueDto, { title: '   ' }),
    ).not.toHaveLength(0);
  });

  it('rejects an over-long title or body', async () => {
    expect(
      await errorsFor(CreateImproveIssueDto, { title: 'a'.repeat(201) }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor(CreateImproveIssueDto, {
        title: 'a',
        body: 'b'.repeat(8001),
      }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor(CreateImproveIssueDto, {
        title: 'a'.repeat(200),
        body: 'b'.repeat(8000),
        start: true,
        model: 'sonnet',
      }),
    ).toHaveLength(0);
  });
});

describe('SaveScheduleDto weekdays', () => {
  const base = {
    model: 'm',
    name: 'n',
    enabled: true,
    hour: 1,
    minute: 1,
    timezone: 'UTC',
    count: 1,
  };

  it('accepts absent, null and ISO weekdays', async () => {
    expect(await errorsFor(SaveScheduleDto, base)).toHaveLength(0);
    expect(
      await errorsFor(SaveScheduleDto, { ...base, weekdays: null }),
    ).toHaveLength(0);
    expect(
      await errorsFor(SaveScheduleDto, { ...base, weekdays: [1, 2, 3, 4, 5] }),
    ).toHaveLength(0);
  });

  it.each([[[0]], [[8]], [[1.5]], [['1']], [[1, 1]]])(
    'rejects %j',
    async (weekdays) => {
      expect(
        await errorsFor(SaveScheduleDto, { ...base, weekdays }),
      ).not.toHaveLength(0);
    },
  );
});
