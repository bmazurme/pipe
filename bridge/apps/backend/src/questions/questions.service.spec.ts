import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Job } from '../worker/entities/job.entity';
import { TaskQuestion } from './entities/task-question.entity';
import { projectOf, QuestionsService } from './questions.service';

type Row = Partial<TaskQuestion> & { id: number; taskKey: string };

describe('projectOf', () => {
  it('is the project number of a pipeline task key', () => {
    expect(projectOf('173:628')).toBe('173');
  });

  it('is null for a plain file task or anything else', () => {
    expect(projectOf('file:9')).toBeNull();
    expect(projectOf('abc')).toBeNull();
  });
});

describe('QuestionsService', () => {
  let service: QuestionsService;
  let job: { id: number; taskKey: string | null } | null;
  let open: Row[];
  let stored: Row[];
  let save: jest.Mock;

  const at = (iso: string) => new Date(iso);

  beforeEach(async () => {
    job = { id: 5, taskKey: '173:628' };
    open = [];
    stored = [];
    save = jest.fn((value: unknown) => Promise.resolve(value));

    const module = await Test.createTestingModule({
      providers: [
        QuestionsService,
        {
          provide: getRepositoryToken(TaskQuestion),
          useValue: {
            save,
            find: () => Promise.resolve(stored),
            findOne: ({ where }: { where: { id: number } }) =>
              Promise.resolve(stored.find((q) => q.id === where.id) ?? null),
            createQueryBuilder: () => {
              const query = {
                where: () => query,
                andWhere: () => query,
                getMany: () => Promise.resolve(open),
              };
              return query;
            },
          },
        },
        {
          provide: getRepositoryToken(Job),
          useValue: { findOne: () => Promise.resolve(job) },
        },
      ],
    }).compile();

    service = module.get(QuestionsService);
  });

  describe('addFromRun', () => {
    it('stores new questions under the job’s task, tagged with the project', async () => {
      const added = await service.addFromRun(5, 7, [
        '  Which branch?  ',
        'Is X ok?',
      ]);

      expect(added).toBe(2);
      expect(save).toHaveBeenCalledWith([
        expect.objectContaining({
          userId: 7,
          jobId: 5,
          taskKey: '173:628',
          project: '173',
          text: 'Which branch?',
        }),
        expect.objectContaining({ text: 'Is X ok?' }),
      ]);
    });

    it('skips a question already open on the task, and repeats within the report', async () => {
      open = [{ id: 1, taskKey: '173:628', text: 'Which branch?' }];

      const added = await service.addFromRun(5, 7, [
        'which  branch?',
        'New one',
        'new one',
      ]);

      expect(added).toBe(1);
      expect(save).toHaveBeenCalledWith([
        expect.objectContaining({ text: 'New one' }),
      ]);
    });

    it('stores nothing for a job without a task key', async () => {
      job = { id: 5, taskKey: null };

      expect(await service.addFromRun(5, 7, ['Q?'])).toBe(0);
      expect(save).not.toHaveBeenCalled();
    });

    it('404s for a job that is not the caller’s', async () => {
      job = null;

      await expect(service.addFromRun(5, 7, ['Q?'])).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listCards', () => {
    beforeEach(() => {
      stored = [
        {
          id: 4,
          taskKey: '9:1',
          project: '9',
          text: 'd',
          resolvedAt: at('2026-10-22T12:00:00Z'),
          createdAt: at('2026-10-20T00:00:00Z'),
          updatedAt: at('2026-10-22T12:00:00Z'),
        },
        {
          id: 3,
          taskKey: '173:628',
          project: '173',
          text: 'c',
          resolvedAt: null,
          createdAt: at('2026-10-21T00:00:00Z'),
          updatedAt: at('2026-10-21T00:00:00Z'),
        },
        {
          id: 2,
          taskKey: '173:628',
          project: '173',
          text: 'b',
          resolvedAt: at('2026-10-21T10:00:00Z'),
          createdAt: at('2026-10-20T00:00:00Z'),
          updatedAt: at('2026-10-21T10:00:00Z'),
        },
      ];
    });

    it('lists cards with something still open, questions oldest first', async () => {
      const cards = await service.listCards(7, false);

      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        taskKey: '173:628',
        project: '173',
        openCount: 1,
        archived: false,
      });
      expect(cards[0].questions.map((q) => [q.text, q.resolved])).toEqual([
        ['b', true],
        ['c', false],
      ]);
    });

    it('moves a card to the archive once every question is resolved', async () => {
      const cards = await service.listCards(7, true);

      expect(cards.map((c) => c.taskKey)).toEqual(['9:1']);
      expect(cards[0]).toMatchObject({ archived: true, openCount: 0 });
    });
  });

  describe('setResolved', () => {
    it('ticks a question off and back on', async () => {
      stored = [{ id: 3, taskKey: '1:1', text: 'c', resolvedAt: null }];

      expect((await service.setResolved(3, 7, true)).resolvedAt).toBeInstanceOf(
        Date,
      );
      expect((await service.setResolved(3, 7, false)).resolvedAt).toBeNull();
    });

    it('404s for a question that is not the caller’s', async () => {
      await expect(service.setResolved(99, 7, true)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
