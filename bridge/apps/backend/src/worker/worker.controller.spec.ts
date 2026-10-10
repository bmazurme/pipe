import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';

describe('WorkerController', () => {
  let controller: WorkerController;
  let workerService: { recordHeartbeat: jest.Mock };

  beforeEach(async () => {
    workerService = { recordHeartbeat: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkerController],
      providers: [
        { provide: WorkerService, useValue: workerService },
        { provide: ClaudeCredentialsService, useValue: {} },
      ],
    })
      .overrideGuard(JwtOrApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(WorkerController);
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
      const result = await controller.get(5, { id: 7 }, 12);

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
