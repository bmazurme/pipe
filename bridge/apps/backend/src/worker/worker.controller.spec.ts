import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';
import { WorkersService } from './workers.service';

describe('WorkerController', () => {
  let controller: WorkerController;
  let workerService: { recordHeartbeat: jest.Mock; assertHeldBy: jest.Mock };
  let workersService: { touch: jest.Mock };

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
        { provide: ClaudeCredentialsService, useValue: {} },
        { provide: WorkersService, useValue: workersService },
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
    let claimController: WorkerController;

    beforeEach(async () => {
      credentials = { resolveForRun: jest.fn().mockResolvedValue('tok') };
      (workerService as Record<string, jest.Mock>).claim = jest.fn();
      (workerService as Record<string, jest.Mock>).resolveProvider = jest
        .fn()
        .mockResolvedValue(null);

      const module = await Test.createTestingModule({
        controllers: [WorkerController],
        providers: [
          { provide: WorkerService, useValue: workerService },
          { provide: ClaudeCredentialsService, useValue: credentials },
          { provide: WorkersService, useValue: workersService },
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

      expect(credentials.resolveForRun).toHaveBeenCalledWith(7, null);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ claudeToken: 'tok' }),
      );

      await claim(job('opus', 9));
      expect(credentials.resolveForRun).toHaveBeenLastCalledWith(7, 9);
    });

    it('gives no Claude token to a gpt/deepseek/qwen job', async () => {
      const res = await claim(job('gpt', null));

      expect(credentials.resolveForRun).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ claudeToken: null }),
      );
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

  describe('cancelState', () => {
    it('returns only id, status and cancelRequestedAt', async () => {
      const cancelRequestedAt = new Date('2026-01-01T00:00:00Z');
      (workerService as Record<string, jest.Mock>).getCancelState = jest
        .fn()
        .mockResolvedValue({
          id: 5,
          status: 'running',
          cancelRequestedAt,
          logs: 'should not leak',
          contextText: 'should not leak',
        });

      const result = await controller.cancelState(5, { id: 7 });

      expect(
        (workerService as Record<string, jest.Mock>).getCancelState,
      ).toHaveBeenCalledWith(5, 7);
      expect(result).toEqual({ id: 5, status: 'running', cancelRequestedAt });
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
          { provide: ClaudeCredentialsService, useValue: {} },
          { provide: WorkersService, useValue: workersService },
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
});
