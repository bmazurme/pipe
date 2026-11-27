import { ConflictException } from '@nestjs/common';

import { ImproveRunStatus } from './entities/improve-run.entity';
import { ImproveService } from './improve.service';

// A6: a cheap model reads the task before the real run; blocking questions make the run wait for the owner's answers.
const ISSUE = {
  number: 7,
  title: 'Add export',
  body: 'Export the report.',
  state: 'open',
  isPull: false,
  labels: [],
  htmlUrl: 'u',
  createdAt: '',
};

function setup(
  options: {
    mode?: 'off' | 'costly' | 'always';
    questions?: object[];
    issue?: object;
  } = {},
) {
  const runs = {
    create: jest.fn((row: object) => ({ id: 4, ...row })),
    save: jest.fn(async (row: object) => ({ id: 4, ...row })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
  };
  const github = {
    isReady: jest.fn().mockReturnValue(true),
    getIssue: jest.fn().mockResolvedValue({ ...ISSUE, ...options.issue }),
    getBranchSha: jest.fn(),
  };
  const handoff = {
    prepareSnapshot: jest
      .fn()
      .mockResolvedValue({ baseSha: 'base', files: [], baseline: {} }),
    handToWorker: jest.fn().mockResolvedValue({
      job: { id: 500 },
      baseSha: 'base',
      baseline: {},
      fileCount: 3,
      model: 'sonnet',
      routing: null,
    }),
  };
  const workers = {
    cancel: jest.fn().mockResolvedValue(undefined),
    findStatuses: jest.fn().mockResolvedValue([]),
    findRetriesOf: jest.fn().mockResolvedValue(new Map()),
  };
  const storage = {
    findOwned: jest.fn().mockResolvedValue({ id: 9 }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const notifier = { send: jest.fn().mockResolvedValue(true) };
  const publisher = { finish: jest.fn().mockResolvedValue(undefined) };
  const settingsRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        options.mode ? { clarifyBeforeRun: options.mode } : null,
      ),
  };
  const questions = {
    forJob: jest.fn().mockResolvedValue(options.questions ?? []),
    resolveForJob: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ImproveService(
    runs as never,
    github as never,
    {} as never,
    storage as never,
    workers as never,
    notifier as never,
    { query: jest.fn() } as never,
    { record: jest.fn() } as never,
    {} as never,
    publisher as never,
    handoff as never,
    settingsRepo as never,
    questions as never,
  );

  return {
    service,
    runs,
    github,
    handoff,
    workers,
    storage,
    notifier,
    publisher,
    questions,
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const prepare = (
  service: ImproveService,
  run: object,
  contextId: number | null = null,
) =>
  (
    service as unknown as {
      prepareRun: (r: object, i: object, c: number | null) => Promise<void>;
    }
  ).prepareRun(run, ISSUE, contextId);
const run = (over: object = {}) => ({
  id: 4,
  userId: 3,
  kind: 'issue',
  issueNumber: 7,
  issueTitle: 'Add export',
  model: 'sonnet',
  trigger: 'manual',
  status: ImproveRunStatus.Preparing,
  jobId: null,
  contextId: null,
  ...over,
});
const taskOf = (handoff: { handToWorker: jest.Mock }, call = 0) =>
  handoff.handToWorker.mock.calls[call][2] as { body: string };

describe('ImproveService: reading the task before the run (A6)', () => {
  describe('whether to read it', () => {
    it('goes straight to the work when it is off (the default)', async () => {
      const { service, handoff } = setup();

      await prepare(service, run());

      expect(handoff.handToWorker).toHaveBeenCalledTimes(1);
      expect(handoff.handToWorker.mock.calls[0][1]).toBe('sonnet');
      expect(taskOf(handoff).body).not.toContain('Read this task BEFORE');
    });

    it('«costly» on a run with a model chosen by name that is not Haiku: Haiku reads the task first, as a job that cannot verify (it only reads)', async () => {
      const { service, handoff, runs } = setup({ mode: 'costly' });
      const r = run();

      await prepare(service, r, 12);

      expect(handoff.handToWorker).toHaveBeenCalledTimes(1);
      const [, model, task, taskKey, fileName, , , contextId, withBaseline] =
        handoff.handToWorker.mock.calls[0];

      expect(model).toBe('haiku');
      expect(task.body).toContain('Do NOT change any file');
      expect(task.body).toContain('Export the report.');
      expect(taskKey).toBe('improve:7');
      expect(fileName).toBe('improve-clarify-7.subscription.zip');
      expect(contextId).toBe(12);
      expect(withBaseline).toBe(false);
      expect(runs.update).toHaveBeenCalledWith(
        { id: 4, status: ImproveRunStatus.Preparing },
        expect.objectContaining({
          status: ImproveRunStatus.Clarifying,
          jobId: 500,
        }),
      );
      expect(r.status).toBe(ImproveRunStatus.Clarifying);
    });

    it.each([
      ['«costly» and Haiku itself', 'costly', 'haiku', 'manual'],
      [
        '«costly» and auto (the router mostly picks Haiku)',
        'costly',
        'auto',
        'manual',
      ],
      ['a CI repair', 'always', 'opus', 'ci'],
      ['a chat fix', 'always', 'opus', 'chat'],
      ['a conflict redo', 'always', 'opus', 'conflict'],
    ] as const)(
      'does not read it for %s',
      async (_why, mode, model, trigger) => {
        const { service, handoff } = setup({ mode });

        await prepare(service, run({ model, trigger }));

        expect(handoff.handToWorker).toHaveBeenCalledTimes(1);
        expect(handoff.handToWorker.mock.calls[0][1]).toBe(model);
      },
    );

    it('«always» reads every run somebody started', async () => {
      const { service, handoff } = setup({ mode: 'always' });

      await prepare(service, run({ model: 'haiku', trigger: 'schedule' }));

      expect(handoff.handToWorker.mock.calls[0][1]).toBe('haiku');
      expect(taskOf(handoff).body).toContain('Do NOT change any file');
    });

    it('goes on with the real run when the reading cannot be started — it is advisory, nothing is lost', async () => {
      const { service, handoff, runs } = setup({ mode: 'costly' });

      handoff.handToWorker.mockRejectedValueOnce(new Error('no worker'));
      await prepare(service, run());

      expect(handoff.handToWorker).toHaveBeenCalledTimes(2);
      expect(handoff.handToWorker.mock.calls[1][1]).toBe('sonnet');
      expect(runs.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: ImproveRunStatus.Queued }),
      );
    });
  });

  describe('when the reading is done', () => {
    const clarifying = (over: object = {}) =>
      run({ status: ImproveRunStatus.Clarifying, jobId: 500, ...over });
    const job = (status: string, over: object = {}) => ({
      id: 500,
      userId: 3,
      status,
      resultFileId: 9,
      errorMessage: null,
      ...over,
    });

    it('starts the real run when nothing blocks — with the task as it is, and drops what the reading left behind', async () => {
      const { service, handoff, storage } = setup();

      await service.advanceOne(
        clarifying() as never,
        job('succeeded') as never,
      );

      expect(handoff.handToWorker).toHaveBeenCalledTimes(1);
      expect(handoff.handToWorker.mock.calls[0][1]).toBe('sonnet');
      expect(taskOf(handoff).body).not.toContain("The owner's answers");
      expect(storage.delete).toHaveBeenCalled();
    });

    it('makes the run wait when something blocks, and says so on Telegram with the number and where to answer', async () => {
      const { service, handoff, runs, notifier } = setup({
        questions: [
          { id: 1, text: 'CSV or XLSX?', answer: null, resolvedAt: null },
          { id: 2, text: 'Which period?', answer: null, resolvedAt: null },
        ],
      });
      const r = clarifying();

      await service.advanceOne(r as never, job('succeeded') as never);

      expect(handoff.handToWorker).not.toHaveBeenCalled();
      expect(runs.update).toHaveBeenCalledWith(
        { id: 4, status: ImproveRunStatus.Preparing },
        expect.objectContaining({
          status: ImproveRunStatus.AwaitingAnswer,
          note: expect.stringContaining('Ждёт ответов: 2'),
        }),
      );
      expect(r.status).toBe(ImproveRunStatus.AwaitingAnswer);
      expect(notifier.send).toHaveBeenCalledWith(
        expect.stringMatching(/перед запуском нужны ответы \(2\).*improve:7/),
      );
    });

    it('does not count a question the owner already settled', async () => {
      const { service, handoff } = setup({
        questions: [
          { id: 1, text: 'old?', answer: 'x', resolvedAt: new Date() },
        ],
      });

      await service.advanceOne(
        clarifying() as never,
        job('succeeded') as never,
      );

      expect(handoff.handToWorker).toHaveBeenCalledTimes(1);
    });

    it('goes on with the real run when the reading itself failed (advisory)', async () => {
      const { service, handoff, questions } = setup({
        questions: [{ id: 1, text: 'x', answer: null, resolvedAt: null }],
      });

      await service.advanceOne(
        clarifying() as never,
        job('failed', { errorMessage: 'boom' }) as never,
      );

      expect(questions.forJob).not.toHaveBeenCalled();
      expect(handoff.handToWorker).toHaveBeenCalledTimes(1);
    });

    it('is cancelled when the owner stopped the reading job', async () => {
      const { service, publisher, handoff } = setup();

      await service.advanceOne(
        clarifying() as never,
        job('cancelled') as never,
      );

      expect(publisher.finish).toHaveBeenCalledWith(
        expect.anything(),
        ImproveRunStatus.Cancelled,
        expect.anything(),
      );
      expect(handoff.handToWorker).not.toHaveBeenCalled();
    });

    it('waits while the reading is queued or running', async () => {
      const { service, runs, handoff } = setup();

      await service.advanceOne(clarifying() as never, job('running') as never);

      expect(handoff.handToWorker).not.toHaveBeenCalled();
      expect(runs.update).not.toHaveBeenCalled();
    });

    it('does nothing when another tick already claimed the run', async () => {
      const { service, runs, handoff } = setup();

      runs.update.mockResolvedValueOnce({ affected: 0 });
      await service.advanceOne(
        clarifying() as never,
        job('succeeded') as never,
      );

      expect(handoff.handToWorker).not.toHaveBeenCalled();
    });

    it('cancels the run when the issue was closed in the meantime', async () => {
      const { service, publisher, handoff } = setup({
        issue: { state: 'closed' },
      });

      await service.advanceOne(
        clarifying() as never,
        job('succeeded') as never,
      );

      expect(publisher.finish).toHaveBeenCalledWith(
        expect.anything(),
        ImproveRunStatus.Cancelled,
        expect.objectContaining({
          note: expect.stringContaining('уже не открытая'),
        }),
      );
      expect(handoff.handToWorker).not.toHaveBeenCalled();
    });
  });

  describe('when the owner has answered', () => {
    const waiting = (over: object = {}) =>
      run({
        status: ImproveRunStatus.AwaitingAnswer,
        jobId: 500,
        contextId: 12,
        ...over,
      });
    const resume = (service: ImproveService) =>
      (
        service as unknown as { resumeAnswered: () => Promise<void> }
      ).resumeAnswered();

    it('starts the run by itself once every question has an answer — with the answers in its task, and its context', async () => {
      const { service, handoff, runs } = setup({
        questions: [
          { text: 'CSV or XLSX?', answer: ' CSV ' },
          { text: 'Which period?', answer: 'last month' },
        ],
      });

      runs.find.mockResolvedValue([waiting()]);
      await resume(service);

      expect(handoff.handToWorker).toHaveBeenCalledTimes(1);
      const body = taskOf(handoff).body;

      expect(body).toContain('Export the report.');
      expect(body).toContain("The owner's answers");
      expect(body).toContain('- Q: CSV or XLSX?\n  A: CSV');
      expect(body).toContain('A: last month');
      expect(handoff.handToWorker.mock.calls[0][7]).toBe(12);
      expect(runs.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: ImproveRunStatus.Queued,
          note: expect.stringContaining('после уточнения'),
        }),
      );
    });

    it('keeps waiting while a question has no answer', async () => {
      const { service, handoff, runs } = setup({
        questions: [
          { text: 'a?', answer: 'x' },
          { text: 'b?', answer: null },
        ],
      });

      runs.find.mockResolvedValue([waiting()]);
      await resume(service);

      expect(handoff.handToWorker).not.toHaveBeenCalled();
    });

    it('starts only once even if two ticks overlap', async () => {
      const { service, handoff, runs } = setup({
        questions: [{ text: 'a?', answer: 'x' }],
      });

      runs.find.mockResolvedValue([waiting()]);
      runs.update
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValueOnce({ affected: 0 });
      await Promise.all([resume(service), resume(service)]);
      await settle();

      expect(handoff.handToWorker.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it('fails the run, saying why, when it cannot be started after the answers', async () => {
      const { service, handoff, runs } = setup({
        questions: [{ text: 'a?', answer: 'x' }],
      });

      runs.find.mockResolvedValue([waiting()]);
      handoff.handToWorker.mockRejectedValueOnce(new Error('snapshot failed'));
      await resume(service);

      expect(runs.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: ImproveRunStatus.Failed,
          error: 'snapshot failed',
        }),
      );
    });
  });

  describe('«Запустить без ответов»', () => {
    it('starts the run now, with the answers there are, saying that what stayed open is for the worker to decide, and settles the open questions', async () => {
      const { service, handoff, runs, questions } = setup({
        questions: [
          { text: 'CSV or XLSX?', answer: 'CSV' },
          { text: 'Which period?', answer: null },
        ],
      });

      runs.findOne.mockResolvedValue(
        run({ status: ImproveRunStatus.AwaitingAnswer, jobId: 500 }),
      );
      await service.continueRun(4, 3);

      const body = taskOf(handoff).body;

      expect(body).toContain('A: CSV');
      expect(body).toContain('A: (no answer — decide yourself');
      expect(questions.resolveForJob).toHaveBeenCalledWith(3, 500);
    });

    it('is refused for a run that is not waiting, and for an unknown one', async () => {
      const { service, runs } = setup();

      runs.findOne.mockResolvedValue(
        run({ status: ImproveRunStatus.Running, jobId: 500 }),
      );
      await expect(service.continueRun(4, 3)).rejects.toBeInstanceOf(
        ConflictException,
      );
      runs.findOne.mockResolvedValue(null);
      await expect(service.continueRun(4, 3)).rejects.toThrow('Run not found');
    });
  });

  describe('cancelling', () => {
    it.each([ImproveRunStatus.Clarifying, ImproveRunStatus.AwaitingAnswer])(
      'cancels a run that is %s, and stops its job',
      async (status) => {
        const { service, runs, workers } = setup();

        runs.findOne.mockResolvedValue(run({ status, jobId: 500 }));
        await service.cancelRun(4, 3);

        expect(runs.update).toHaveBeenCalledWith(
          expect.objectContaining({ id: 4 }),
          expect.objectContaining({ status: ImproveRunStatus.Cancelled }),
        );
        expect(workers.cancel).toHaveBeenCalledWith(500, 3);
      },
    );
  });

  it("keeps the run's context so that a run that waited still hands it to its worker", async () => {
    const { service, runs, github } = setup();

    github.getBranchSha.mockResolvedValue('b');
    await service.startRun(3, 7, 'sonnet', 'manual', null, 12, {
      issue: ISSUE,
    } as never);
    await settle();

    expect(runs.create).toHaveBeenCalledWith(
      expect.objectContaining({ contextId: 12 }),
    );
  });
});
