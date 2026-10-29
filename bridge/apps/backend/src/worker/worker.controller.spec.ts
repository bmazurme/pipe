import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { ProviderCredentialsService } from './provider-credentials.service';
import { QuestionsService } from '../questions/questions.service';
import { ClaudeUsageService } from './claude-usage.service';
import { LimitAlertsService } from './limit-alerts.service';
import { RunCredentialsService } from './run-credentials.service';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';
import { WorkersService } from './workers.service';

describe('WorkerController', () => {
  const limitAlerts = { check: jest.fn().mockResolvedValue([]) };

  let controller: WorkerController;
  let workerService: { recordHeartbeat: jest.Mock; assertHeldBy: jest.Mock };
  let workersService: { touch: jest.Mock };
  const questionsService = { addFromRun: jest.fn() };
  const claudeUsage = {
    recordReport: jest.fn(),
    recordUsedCredential: jest.fn(),
  };

  beforeEach(async () => {
    workerService = {
      recordHeartbeat: jest.fn().mockResolvedValue(undefined),
      assertHeldBy: jest.fn().mockResolvedValue(undefined),
    };
    workersService = { touch: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkerController],
      providers: [
        { provide: WorkerService, useValue: workerService },
        { provide: RunCredentialsService, useValue: {} },
        { provide: WorkersService, useValue: workersService },
        { provide: LimitAlertsService, useValue: limitAlerts },
        { provide: ClaudeUsageService, useValue: claudeUsage },
        { provide: QuestionsService, useValue: questionsService },
      ],
    })
      .overrideGuard(JwtOrApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(WorkerController);
  });

  describe('claim — which Claude token a job gets', () => {
    const response = () => {
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        end: jest.fn(),
      };

      return res;
    };
    const job = (model: string, claudeCredentialId: number | null) => ({
      id: 5,
      model,
      claudeCredentialId,
    });
    let credentials: { resolveForRun: jest.Mock };
    let boundTokenId: number | null;
    let claimController: WorkerController;

    beforeEach(async () => {
      boundTokenId = 4;
      credentials = {
        resolveForRun: jest.fn().mockResolvedValue({ id: 4, token: 'tok' }),
      };
      (workerService as Record<string, jest.Mock>).claim = jest.fn();
      claudeUsage.recordUsedCredential = jest.fn();

      const module = await Test.createTestingModule({
        controllers: [WorkerController],
        providers: [
          { provide: WorkerService, useValue: workerService },
          RunCredentialsService,
          { provide: ClaudeCredentialsService, useValue: credentials },
          {
            provide: ProviderCredentialsService,
            useValue: { resolveForJob: jest.fn().mockResolvedValue(null) },
          },
          {
            provide: WorkersService,
            useValue: {
              ...workersService,
              claudeCredentialIdOf: jest.fn(async () => boundTokenId),
            },
          },
          { provide: LimitAlertsService, useValue: limitAlerts },
          { provide: ClaudeUsageService, useValue: claudeUsage },
          { provide: QuestionsService, useValue: questionsService },
        ],
      })
        .overrideGuard(JwtOrApiKeyGuard)
        .useValue({ canActivate: () => true })
        .compile();

      claimController = module.get(WorkerController);
    });

    const claim = async (claimed: object) => {
      (workerService as Record<string, jest.Mock>).claim.mockResolvedValue(
        claimed,
      );
      const res = response();

      await claimController.claim(
        { workerName: 'w' },
        { id: 7, workerId: 3 },
        res as never,
      );

      return res;
    };

    it("hands a sonnet job the token it picked, or the account's first when it picked none", async () => {
      const res = await claim(job('sonnet', null));

      expect(credentials.resolveForRun).toHaveBeenCalledWith(7, null, 4);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ claudeToken: 'tok' }),
      );

      await claim(job('opus', 9));
      expect(credentials.resolveForRun).toHaveBeenLastCalledWith(7, 9, 4);
    });

    it('records which token the claimed job actually runs on', async () => {
      await claim(job('sonnet', null));
      expect(claudeUsage.recordUsedCredential).toHaveBeenCalledWith(5, 7, 4);
    });

    it('a worker that is not enrolled (a personal API key) has no token of its own', async () => {
      (workerService as Record<string, jest.Mock>).claim.mockResolvedValue(
        job('sonnet', null),
      );

      await claimController.claim(
        { workerName: 'w' },
        { id: 7 },
        response() as never,
      );

      expect(credentials.resolveForRun).toHaveBeenCalledWith(7, null, null);
    });

    it('gives no Claude token to a gpt/deepseek/qwen job', async () => {
      const res = await claim(job('gpt', null));

      expect(credentials.resolveForRun).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ claudeToken: null }),
      );
    });
  });

  describe('list — updatedAfter', () => {
    beforeEach(() => {
      (workerService as Record<string, jest.Mock>).findAllByUser = jest
        .fn()
        .mockResolvedValue([]);
    });

    it('passes a valid date on to the service as a Date', async () => {
      await controller.list({ id: 7 }, '2026-10-16T12:00:00.000Z');

      expect(
        (workerService as Record<string, jest.Mock>).findAllByUser,
      ).toHaveBeenCalledWith(7, new Date('2026-10-16T12:00:00.000Z'), {
        limit: undefined,
        beforeId: undefined,
      });
    });

    it('lists everything when it is absent', async () => {
      await controller.list({ id: 7 });

      expect(
        (workerService as Record<string, jest.Mock>).findAllByUser,
      ).toHaveBeenCalledWith(7, undefined, {
        limit: undefined,
        beforeId: undefined,
      });
    });

    it('passes limit and beforeId on as numbers', async () => {
      await controller.list({ id: 7 }, undefined, '50', '900');

      expect(
        (workerService as Record<string, jest.Mock>).findAllByUser,
      ).toHaveBeenCalledWith(7, undefined, { limit: 50, beforeId: 900 });
    });

    it('answers 400 for a bad limit or beforeId', async () => {
      await expect(controller.list({ id: 7 }, undefined, '0')).rejects.toThrow(
        /limit must be a positive integer/,
      );
      await expect(
        controller.list({ id: 7 }, undefined, undefined, 'x'),
      ).rejects.toThrow(/beforeId must be a positive integer/);
    });

    it('answers 400 for something that is not a date', async () => {
      await expect(controller.list({ id: 7 }, 'yesterday')).rejects.toThrow(
        /updatedAfter must be a valid date/,
      );
    });
  });

  describe('reportUsage — limit alerts', () => {
    const limits = {
      status: 'allowed_warning',
      rateLimitType: 'seven_day',
      isUsingOverage: false,
      windows: { seven_day: { utilization: 0.82, resetsAt: 1 } },
      reportedAt: '2026-10-16T12:00:00.000Z',
    };

    beforeEach(() => limitAlerts.check.mockClear());

    it('hands what was recorded to the alert check, with the token the job used', async () => {
      claudeUsage.recordReport = jest
        .fn()
        .mockResolvedValue({ limits, credentialId: 3 });

      await controller.reportUsage(
        { jobId: 7, limits },
        { id: 7, workerId: 5 },
      );

      expect(limitAlerts.check).toHaveBeenCalledWith({
        userId: 7,
        workerId: 5,
        credentialId: 3,
        limits,
      });
    });

    it('checks nothing when the report held no usable limits', async () => {
      claudeUsage.recordReport = jest.fn().mockResolvedValue(null);

      await controller.reportUsage({ usage: {} }, { id: 7, workerId: 5 });

      expect(limitAlerts.check).not.toHaveBeenCalled();
    });
  });

  describe('heartbeat', () => {
    it('a personal API key reports by name (legacy worker)', async () => {
      await controller.heartbeat({ workerName: 'old-worker' }, { id: 7 });

      expect(workerService.recordHeartbeat).toHaveBeenCalledWith(
        7,
        'old-worker',
      );
      expect(workersService.touch).not.toHaveBeenCalled();
    });

    it('a worker added in the UI is known by its key, whatever name it passes', async () => {
      await controller.heartbeat(
        { workerName: 'anything' },
        { id: 7, workerId: 5 },
      );

      expect(workersService.touch).toHaveBeenCalledWith(5);
      expect(workerService.recordHeartbeat).not.toHaveBeenCalled();
    });
  });

  describe('a worker only touches the job it holds', () => {
    it('asks the service before reporting a job’s cancel state', async () => {
      (workerService as Record<string, jest.Mock>).getCancelState = jest
        .fn()
        .mockResolvedValue({
          id: 5,
          status: 'running',
          cancelRequestedAt: null,
        });

      await controller.cancelState(5, { id: 7, workerId: 3 });

      expect(workerService.assertHeldBy).toHaveBeenCalledWith(5, 7, 3);
    });

    it('does not report anything when the job is held by another worker', async () => {
      workerService.assertHeldBy.mockRejectedValue(new Error('not held'));
      const getCancelState = jest.fn();

      (workerService as Record<string, jest.Mock>).getCancelState =
        getCancelState;

      await expect(
        controller.cancelState(5, { id: 7, workerId: 3 }),
      ).rejects.toThrow('not held');
      expect(getCancelState).not.toHaveBeenCalled();
    });
  });

  describe('reportQuestions', () => {
    it('hands the held job’s id and task key to the questions service', async () => {
      (workerService as Record<string, jest.Mock>).findHeld = jest
        .fn()
        .mockResolvedValue({ id: 5, taskKey: '173:628', userId: 7 });

      await controller.reportQuestions(
        5,
        { questions: ['Q?'] },
        {
          id: 7,
          workerId: 3,
        },
      );

      expect(questionsService.addFromRun).toHaveBeenCalledWith(
        { id: 5, taskKey: '173:628' },
        7,
        ['Q?'],
      );
    });

    it('stores nothing when the job is not held by this worker', async () => {
      questionsService.addFromRun.mockClear();
      (workerService as Record<string, jest.Mock>).findHeld = jest
        .fn()
        .mockRejectedValue(new Error('not held'));

      await expect(
        controller.reportQuestions(
          5,
          { questions: ['Q?'] },
          {
            id: 7,
            workerId: 3,
          },
        ),
      ).rejects.toThrow('not held');
      expect(questionsService.addFromRun).not.toHaveBeenCalled();
    });
  });

  describe('cancelState', () => {
    it('returns only id, status, cancelRequestedAt and extraTimeoutSec', async () => {
      const cancelRequestedAt = new Date('2026-01-01T00:00:00Z');
      (workerService as Record<string, jest.Mock>).getCancelState = jest
        .fn()
        .mockResolvedValue({
          id: 5,
          status: 'running',
          cancelRequestedAt,
          extraTimeoutSec: 1800,
          logs: 'should not leak',
          contextText: 'should not leak',
        });

      const result = await controller.cancelState(5, { id: 7 });

      expect(
        (workerService as Record<string, jest.Mock>).getCancelState,
      ).toHaveBeenCalledWith(5, 7);
      expect(result).toEqual({
        id: 5,
        status: 'running',
        cancelRequestedAt,
        extraTimeoutSec: 1800,
      });
      expect(result).not.toHaveProperty('logs');
      expect(result).not.toHaveProperty('contextText');
    });
  });

  describe('get with logsFrom', () => {
    const job = {
      id: 5,
      sourceFileId: 10,
      resultFileId: null,
      model: 'gpt',
      claudeCredentialId: null,
      contextName: null,
      historyCount: null,
      timeoutSec: null,
      taskKey: '173:628',
      status: 'running',
      logs: 'first chunk\nsecond chunk\n',
      errorMessage: null,
      workerName: 'worker-a',
      claimedAt: null,
      startedAt: null,
      finishedAt: null,
      cancelRequestedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    let app: INestApplication;

    beforeEach(async () => {
      const mocks = workerService as Record<string, jest.Mock>;
      mocks.findOwned = jest.fn().mockResolvedValue(job);
      mocks.findOwnedWithLogsFrom = jest.fn().mockResolvedValue({
        job: { ...job, logs: undefined },
        logsTail: 'second chunk\n',
        logsLength: 25,
      });

      const module: TestingModule = await Test.createTestingModule({
        controllers: [WorkerController],
        providers: [
          { provide: WorkerService, useValue: workerService },
          { provide: RunCredentialsService, useValue: {} },
          { provide: WorkersService, useValue: workersService },
          { provide: LimitAlertsService, useValue: limitAlerts },
          { provide: ClaudeUsageService, useValue: claudeUsage },
          { provide: QuestionsService, useValue: questionsService },
        ],
      })
        .overrideGuard(JwtOrApiKeyGuard)
        .useValue({ canActivate: () => true })
        .compile();

      app = module.createNestApplication();
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('returns the whole log, without logsLength, when logsFrom is absent', async () => {
      const result = await controller.get(5, { id: 7 });

      expect(
        (workerService as Record<string, jest.Mock>).findOwned,
      ).toHaveBeenCalledWith(5, 7);
      expect(result.logs).toBe('first chunk\nsecond chunk\n');
      expect(result).not.toHaveProperty('logsLength');
    });

    it('returns the taskKey, and null when the job has none', async () => {
      const mocks = workerService as Record<string, jest.Mock>;

      expect((await controller.get(5, { id: 7 })).taskKey).toBe('173:628');

      mocks.findOwned.mockResolvedValueOnce({ ...job, taskKey: undefined });
      expect((await controller.get(5, { id: 7 })).taskKey).toBeNull();
    });

    it('returns only the log after logsFrom, plus logsLength', async () => {
      const result = await controller.get(5, { id: 7 }, '12');

      expect(
        (workerService as Record<string, jest.Mock>).findOwnedWithLogsFrom,
      ).toHaveBeenCalledWith(5, 7, 12);
      expect(result.logs).toBe('second chunk\n');
      expect(result.logsLength).toBe(25);
      expect(result.status).toBe('running');
    });

    it('rejects a negative or non-integer logsFrom with 400', async () => {
      for (const logsFrom of ['-1', 'abc', '1.5']) {
        await request(app.getHttpServer())
          .get(`/api/v1/worker/jobs/5?logsFrom=${logsFrom}`)
          .expect(400);
      }

      expect(
        (workerService as Record<string, jest.Mock>).findOwnedWithLogsFrom,
      ).not.toHaveBeenCalled();
    });
  });

  describe('heartbeat', () => {
    it('records a heartbeat for the caller and the reported worker name', async () => {
      await controller.heartbeat({ workerName: 'worker-a' }, { id: 7 });

      expect(workerService.recordHeartbeat).toHaveBeenCalledWith(7, 'worker-a');
    });
  });

  describe('uploadResult', () => {
    it('answers with an empty log, whatever the job carries', async () => {
      (workerService as Record<string, jest.Mock>).setResult = jest
        .fn()
        .mockResolvedValue({
          id: 5,
          status: 'succeeded',
          logs: 'x'.repeat(10),
        });

      const result = await controller.uploadResult(
        5,
        { path: '/tmp/r.zip' } as Express.Multer.File,
        { id: 7, workerId: 3 },
      );

      expect(result.logs).toBe('');
      expect(result.status).toBe('succeeded');
    });
  });
});
