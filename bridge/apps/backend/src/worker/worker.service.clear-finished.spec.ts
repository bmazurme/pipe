import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';

import { ContextUsageRegistry } from '../context/context-usage';
import { ContextService } from '../context/context.service';
import { AppLogService } from '../logs/app-log.service';
import { StorageService } from '../storage/storage.service';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { Job, JobStatus } from './entities/job.entity';
import { Worker } from './entities/worker.entity';
import { JobSweepService } from './job-sweep.service';
import { ProviderCredentialsService } from './provider-credentials.service';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerService } from './worker.service';

describe('WorkerService.removeFinishedOlderThan', () => {
  let service: WorkerService;
  let builder: {
    delete: jest.Mock;
    from: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    execute: jest.Mock;
  };

  beforeEach(async () => {
    builder = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 3 }),
    };
    const module = await Test.createTestingModule({
      providers: [
        WorkerService,
        {
          provide: getRepositoryToken(Job),
          useValue: { createQueryBuilder: jest.fn().mockReturnValue(builder) },
        },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: JobSweepService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: ClaudeCredentialsService, useValue: {} },
        { provide: WorkerHeartbeatService, useValue: {} },
        { provide: AppLogService, useValue: {} },
        { provide: ContextService, useValue: {} },
        { provide: ContextUsageRegistry, useValue: {} },
        { provide: ProviderCredentialsService, useValue: {} },
      ],
    }).compile();

    service = module.get(WorkerService);
  });

  const conditions = () =>
    [...builder.where.mock.calls, ...builder.andWhere.mock.calls].map(
      (call) => call as [string, Record<string, unknown>?],
    );

  it('returns how many rows were deleted', async () => {
    await expect(service.removeFinishedOlderThan(7, 30)).resolves.toEqual({
      removed: 3,
    });
  });

  it('reports 0 when the driver gives no affected count', async () => {
    builder.execute.mockResolvedValue({});
    await expect(service.removeFinishedOlderThan(7, 30)).resolves.toEqual({
      removed: 0,
    });
  });

  it("touches only the caller's jobs", async () => {
    await service.removeFinishedOlderThan(7, 30);
    const own = conditions().find(([sql]) => sql.includes('"userId"'));
    expect(own?.[1]).toEqual({ userId: 7 });
  });

  it('keeps queued, claimed and running jobs', async () => {
    await service.removeFinishedOlderThan(7, 30);
    const statuses = conditions().find(([sql]) => sql.includes('status IN'));
    expect(statuses?.[1]?.statuses).toEqual([
      JobStatus.Succeeded,
      JobStatus.Failed,
      JobStatus.Cancelled,
    ]);
  });

  it('keeps jobs younger than the cutoff', async () => {
    const before = Date.now();
    await service.removeFinishedOlderThan(7, 30);
    const age = conditions().find(([sql]) => sql.includes('"finishedAt" <'));
    const cutoff = (age?.[1]?.cutoff as Date).getTime();
    const day = 24 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(before - 30 * day);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 30 * day);
  });

  it('keeps jobs an Improve or Lab run still points at', async () => {
    await service.removeFinishedOlderThan(7, 30);
    const sql = conditions().map(([text]) => text);
    expect(sql.some((t) => /NOT EXISTS.*improve_runs/.test(t))).toBe(true);
    expect(sql.some((t) => /NOT EXISTS.*lab_runs/.test(t))).toBe(true);
  });
});
