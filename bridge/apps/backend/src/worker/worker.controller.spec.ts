import { Test, TestingModule } from '@nestjs/testing';

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

  describe('heartbeat', () => {
    it('records a heartbeat for the caller and the reported worker name', async () => {
      await controller.heartbeat({ workerName: 'worker-a' }, { id: 7 });

      expect(workerService.recordHeartbeat).toHaveBeenCalledWith(7, 'worker-a');
    });
  });
});
