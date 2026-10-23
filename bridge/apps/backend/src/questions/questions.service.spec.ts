import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Job } from '../worker/entities/job.entity';
import { TaskQuestion } from './entities/task-question.entity';
import { ContextService } from '../context/context.service';
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
  let archivedView: boolean;
  let save: jest.Mock;
  let createContext: jest.Mock;
  let findContextByName: jest.Mock;
  let updateContext: jest.Mock;

  const at = (iso: string) => new Date(iso);

  beforeEach(async () => {
    job = { id: 5, taskKey: '173:628' };
    open = [];
    stored = [];
    createContext = jest.fn(() => Promise.resolve({ id: 41 }));
    findContextByName = jest.fn(() => Promise.resolve(null));
    updateContext = jest.fn(() => Promise.resolve({ id: 41 }));
    save = jest.fn((value: unknown) => Promise.resolve(value));

    const module = await Test.createTestingModule({
      providers: [
        QuestionsService,
        {
          provide: ContextService,
          useValue: {
            create: createContext,
            findByName: findContextByName,
            update: updateContext,
          },
        },
        {
          provide: getRepositoryToken(TaskQuestion),
          useValue: {
            save,
            find: ({
              where,
              order,
            }: {
              where: { taskKey?: string | { value: string[] } };
              order?: { id: 'ASC' | 'DESC' };
            }) => {
              const keys = where?.taskKey;
              const wanted =
                typeof keys === 'string' ? [keys] : keys ? keys.value : null;
              const rows = wanted
                ? stored.filter((q) => wanted.includes(q.taskKey))
                : stored;

              return Promise.resolve(
                order?.id === 'ASC'
                  ? [...rows].sort((a, b) => a.id - b.id)
                  : rows,
              );
            },
            findOne: ({ where }: { where: { id: number } }) =>
              Promise.resolve(stored.find((q) => q.id === where.id) ?? null),
            createQueryBuilder: () => {
              const query = {
                select: () => query,
                groupBy: () => query,
                having: (sql: string) => {
                  archivedView = sql.endsWith('= 0');
                  return query;
                },
                orderBy: () => query,
                limit: () => query,
                where: () => query,
                andWhere: () => query,
                getMany: () => Promise.resolve(open),
                // What the grouping query returns: the tasks of the view, newest activity first.
                getRawMany: () => {
                  const groups = new Map<string, Row[]>();

                  for (const row of stored) {
                    groups.set(row.taskKey, [
                      ...(groups.get(row.taskKey) ?? []),
                      row,
                    ]);
                  }

                  const latest = (rows: Row[]) =>
                    Math.max(...rows.map((r) => r.updatedAt?.getTime() ?? 0));

                  return Promise.resolve(
                    [...groups]
                      .filter(
                        ([, rows]) =>
                          rows.every((r) => r.resolvedAt != null) ===
                          archivedView,
                      )
                      .sort(([, a], [, b]) => latest(b) - latest(a))
                      .map(([taskKey]) => ({ taskKey })),
                  );
                },
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
          jobId: 55,
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

    it('exposes the run each question came from, null when unknown', async () => {
      const cards = await service.listCards(7, false);

      expect(cards[0].questions.map((q) => q.jobId)).toEqual([null, 55]);
    });

    it('still lists a task whose only open question is older than many newer rows', async () => {
      stored = [
        ...Array.from({ length: 1_001 }, (_, i) => ({
          id: 100 + i,
          taskKey: '9:1',
          project: '9',
          text: `n${i}`,
          resolvedAt: at('2026-10-22T12:00:00Z'),
          createdAt: at('2026-10-22T00:00:00Z'),
          updatedAt: at('2026-10-22T12:00:00Z'),
        })),
        {
          id: 1,
          taskKey: '5:5',
          project: '5',
          text: 'old',
          resolvedAt: null,
          createdAt: at('2026-01-01T00:00:00Z'),
          updatedAt: at('2026-01-01T00:00:00Z'),
        },
      ];

      const cards = await service.listCards(7, false);

      expect(cards.map((c) => c.taskKey)).toEqual(['5:5']);
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

  describe('answers', () => {
    it('stores a trimmed answer and resolves the question', async () => {
      stored = [{ id: 3, taskKey: '1:1', text: 'c', resolvedAt: null }];

      const saved = await service.setResolved(3, 7, undefined, '  main  ');

      expect(saved.answer).toBe('main');
      expect(saved.resolvedAt).toBeInstanceOf(Date);
    });

    it('clears the answer when it is empty, without resolving', async () => {
      stored = [
        { id: 3, taskKey: '1:1', text: 'c', answer: 'x', resolvedAt: null },
      ];

      const saved = await service.setResolved(3, 7, undefined, '  ');

      expect(saved.answer).toBeNull();
      expect(saved.resolvedAt).toBeNull();
    });

    it('rejects an update with neither field', async () => {
      stored = [{ id: 3, taskKey: '1:1', text: 'c', resolvedAt: null }];

      await expect(service.setResolved(3, 7)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('builds context text from answered questions only', () => {
      expect(
        service.buildContextText([
          { text: 'A?', answer: 'yes' },
          { text: 'B?', answer: null },
          { text: 'C?', answer: 'no' },
        ]),
      ).toBe('Вопрос: A?\nОтвет: yes\n\nВопрос: C?\nОтвет: no');
    });

    it('creates a named context for the caller', async () => {
      stored = [
        { id: 1, taskKey: '1:1', text: 'A?', answer: 'yes' },
        { id: 2, taskKey: '1:1', text: 'B?', answer: null },
      ];

      expect(await service.createContext(7, '1:1')).toEqual({
        contextId: 41,
        updated: false,
      });
      expect(createContext).toHaveBeenCalledWith(7, {
        name: 'Ответы: 1:1',
        content: 'Вопрос: A?\nОтвет: yes',
      });
    });

    it('updates the existing context instead of creating a second one', async () => {
      stored = [{ id: 1, taskKey: '1:1', text: 'A?', answer: 'later' }];
      findContextByName.mockResolvedValue({ id: 41 });

      expect(await service.createContext(7, '1:1')).toEqual({
        contextId: 41,
        updated: true,
      });
      expect(findContextByName).toHaveBeenCalledWith(7, 'Ответы: 1:1');
      expect(updateContext).toHaveBeenCalledWith(41, 7, {
        content: 'Вопрос: A?\nОтвет: later',
      });
      expect(createContext).not.toHaveBeenCalled();
    });

    it('404s when nothing is answered', async () => {
      stored = [{ id: 2, taskKey: '1:1', text: 'B?', answer: null }];

      await expect(service.createContext(7, '1:1')).rejects.toThrow(
        NotFoundException,
      );
      expect(createContext).not.toHaveBeenCalled();
    });
  });
});
