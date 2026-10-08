import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { ContextService } from '../context/context.service';
import { AppLogService } from '../logs/app-log.service';
import { StorageService } from '../storage/storage.service';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { Job, JobModel, JobStatus } from './entities/job.entity';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerService } from './worker.service';

type MockRepository = Partial<Record<keyof Repository<Job>, jest.Mock>>;

function createMockRepository(): MockRepository {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    query: jest.fn(),
  };
}

describe('WorkerService', () => {
  let service: WorkerService;
  let repository: MockRepository;
  let storageService: Partial<Record<keyof StorageService, jest.Mock>>;
  let claudeCredentialsService: Partial<
    Record<keyof ClaudeCredentialsService, jest.Mock>
  >;
  let heartbeatService: Partial<
    Record<keyof WorkerHeartbeatService, jest.Mock>
  >;
  let appLogs: { record: jest.Mock };
  let contextService: { findOwned: jest.Mock };

  beforeEach(async () => {
    repository = createMockRepository();
    storageService = {
      findOwned: jest.fn(),
      create: jest.fn(),
      path: jest.fn(),
    };
    claudeCredentialsService = {
      resolveToken: jest.fn(),
    };
    heartbeatService = {
      record: jest.fn(),
    };
    repository.find!.mockResolvedValue([]);
    (repository as { metadata?: unknown }).metadata = {
      columns: ['id', 'userId', 'status', 'logs', 'createdAt'].map(
        (propertyName) => ({ propertyName }),
      ),
    };
    appLogs = { record: jest.fn() };
    contextService = { findOwned: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerService,
        { provide: getRepositoryToken(Job), useValue: repository },
        { provide: StorageService, useValue: storageService },
        {
          provide: ClaudeCredentialsService,
          useValue: claudeCredentialsService,
        },
        { provide: WorkerHeartbeatService, useValue: heartbeatService },
        { provide: AppLogService, useValue: appLogs },
        { provide: ContextService, useValue: contextService },
      ],
    }).compile();

    service = module.get(WorkerService);
  });

  describe('findAllByUser', () => {
    it('selects every column except logs', async () => {
      await service.findAllByUser(7);

      const options = repository.find!.mock.calls[0][0] as {
        select: string[];
        where: { userId: number };
      };
      expect(options.where).toEqual({ userId: 7 });
      expect(options.select).toContain('id');
      expect(options.select).toContain('status');
      expect(options.select).not.toContain('logs');
    });
  });

  describe('recordHeartbeat', () => {
    it('records a heartbeat without touching any job row', async () => {
      await service.recordHeartbeat(7, 'worker-a');

      expect(heartbeatService.record).toHaveBeenCalledWith(7, 'worker-a');
      expect(repository.query).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('rejects a source file the user does not own', async () => {
      storageService.findOwned!.mockRejectedValue(
        new NotFoundException('File not found'),
      );

      await expect(
        service.create(7, { sourceFileId: 1, model: JobModel.Sonnet }),
      ).rejects.toThrow(NotFoundException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects an encrypted parcel', async () => {
      storageService.findOwned!.mockResolvedValue({
        id: 1,
        originalName: '402-6.subscription.zip.enc',
      });

      await expect(
        service.create(7, { sourceFileId: 1, model: JobModel.Gpt }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('queues a job for an unencrypted parcel', async () => {
      storageService.findOwned!.mockResolvedValue({
        id: 1,
        originalName: '402-6.subscription.zip',
      });
      repository.save!.mockImplementation((job) =>
        Promise.resolve({ id: 10, ...job }),
      );

      const job = await service.create(7, {
        sourceFileId: 1,
        model: JobModel.Deepseek,
      });

      expect(repository.save).toHaveBeenCalledWith({
        userId: 7,
        sourceFileId: 1,
        model: JobModel.Deepseek,
        claudeCredentialId: null,
        taskKey: 'file:1',
        contextName: null,
        contextText: null,
        historyText: null,
        historyCount: null,
        status: JobStatus.Queued,
      });
      expect(job).toMatchObject({ id: 10, status: JobStatus.Queued });
    });

    it('rejects a Claude credential the user does not own', async () => {
      storageService.findOwned!.mockResolvedValue({
        id: 1,
        originalName: '402-6.subscription.zip',
      });
      claudeCredentialsService.resolveToken!.mockResolvedValue(null);

      await expect(
        service.create(7, {
          sourceFileId: 1,
          model: JobModel.Sonnet,
          claudeCredentialId: 99,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('persists the chosen Claude credential id', async () => {
      storageService.findOwned!.mockResolvedValue({
        id: 1,
        originalName: '402-6.subscription.zip',
      });
      claudeCredentialsService.resolveToken!.mockResolvedValue(
        'sk-ant-oat-test',
      );
      repository.save!.mockImplementation((job) =>
        Promise.resolve({ id: 10, ...job }),
      );

      await service.create(7, {
        sourceFileId: 1,
        model: JobModel.Opus,
        claudeCredentialId: 3,
      });

      expect(claudeCredentialsService.resolveToken).toHaveBeenCalledWith(3, 7);
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ claudeCredentialId: 3 }),
      );
    });
  });

  describe('findOwned', () => {
    it('throws NotFoundException when the job does not belong to the user', async () => {
      repository.findOne!.mockResolvedValue(null);
      await expect(service.findOwned(1, 7)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('refuses to remove a claimed job', async () => {
      repository.findOne!.mockResolvedValue({
        id: 1,
        status: JobStatus.Claimed,
      });
      await expect(service.remove(1, 7)).rejects.toThrow(BadRequestException);
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('refuses to remove a running job', async () => {
      repository.findOne!.mockResolvedValue({
        id: 1,
        status: JobStatus.Running,
      });
      await expect(service.remove(1, 7)).rejects.toThrow(BadRequestException);
    });

    it('removes a queued job', async () => {
      repository.findOne!.mockResolvedValue({
        id: 1,
        status: JobStatus.Queued,
      });
      await service.remove(1, 7);
      expect(repository.delete).toHaveBeenCalledWith(1);
    });

    it('removes a terminal (succeeded/failed) job', async () => {
      repository.findOne!.mockResolvedValue({
        id: 1,
        status: JobStatus.Succeeded,
      });
      await service.remove(1, 7);
      expect(repository.delete).toHaveBeenCalledWith(1);
    });
  });

  describe('lost jobs', () => {
    const stale = (over: Partial<Job> = {}) =>
      ({
        id: 45,
        status: JobStatus.Running,
        model: JobModel.Sonnet,
        workerName: 'swarm-worker',
        logs: 'Running claude...',
        errorMessage: null,
        finishedAt: null,
        startedAt: new Date(Date.now() - 40 * 60_000),
        ...over,
      }) as Job;

    it('fails the jobs a worker still holds when it comes back asking for work', async () => {
      const lost = stale();
      repository.find!.mockResolvedValue([lost]);
      repository.save!.mockImplementation((j) => Promise.resolve(j));
      repository.query!.mockResolvedValue([[], 0]);

      await service.claim(7, 'swarm-worker');

      expect(lost.status).toBe(JobStatus.Failed);
      expect(lost.errorMessage).toMatch(/restarted or lost/);
      expect(lost.finishedAt).toBeInstanceOf(Date);
      expect(lost.logs).toContain('restarted or lost');
      expect(appLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'job.failed' }),
      );
    });

    it("only looks at this worker's own silent jobs", async () => {
      repository.query!.mockResolvedValue([[], 0]);

      await service.claim(7, 'swarm-worker');

      const where = (
        repository.find!.mock.calls[0][0] as { where: Record<string, unknown> }
      ).where;
      expect(where).toMatchObject({ userId: 7, workerName: 'swarm-worker' });
      // 10 minutes of silence, expressed as an updatedAt cutoff — a job that logged
      // a minute ago (a live sibling replica) does not match.
      expect(where.updatedAt).toBeDefined();
    });

    it('does nothing without a worker name', async () => {
      repository.query!.mockResolvedValue([[], 0]);

      await service.claim(7);

      expect(repository.find).not.toHaveBeenCalled();
    });

    it('sweeps jobs silent for hours, whichever worker held them', async () => {
      const lost = stale({ workerName: 'gone-worker' });
      repository.find!.mockResolvedValue([lost]);
      repository.save!.mockImplementation((j) => Promise.resolve(j));

      await service.sweepLostJobs();

      const where = (
        repository.find!.mock.calls[0][0] as { where: Record<string, unknown> }
      ).where;
      expect(where).not.toHaveProperty('workerName');
      expect(lost.status).toBe(JobStatus.Failed);
    });

    it('swallows a failing sweep instead of crashing the scheduler', async () => {
      repository.find!.mockRejectedValue(new Error('db down'));

      await expect(service.sweepLostJobs()).resolves.toBeUndefined();
    });
  });

  describe('claim', () => {
    // node-postgres (via TypeORM's Repository.query) returns
    // [rows, affectedCount] for an UPDATE, not a flat rows array — these
    // mocks match that real shape, not a plain SELECT's.
    it('returns null when nothing is queued', async () => {
      repository.query!.mockResolvedValue([[], 0]);
      await expect(service.claim(7)).resolves.toBeNull();
      expect(repository.findOneBy).not.toHaveBeenCalled();
    });

    it('claims the oldest queued job atomically via SKIP LOCKED', async () => {
      repository.query!.mockResolvedValue([[{ id: 42 }], 1]);
      repository.findOneBy!.mockResolvedValue({
        id: 42,
        status: JobStatus.Claimed,
      });

      const job = await service.claim(7, 'worker-host-1');

      expect(repository.query).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE SKIP LOCKED'),
        [JobStatus.Claimed, 'worker-host-1', JobStatus.Queued, 7],
      );
      expect(repository.findOneBy).toHaveBeenCalledWith({ id: 42 });
      expect(job).toMatchObject({ id: 42, status: JobStatus.Claimed });
    });

    it('records a heartbeat for the named worker even when nothing is queued', async () => {
      repository.query!.mockResolvedValue([[], 0]);
      await service.claim(7, 'worker-host-1');
      expect(heartbeatService.record).toHaveBeenCalledWith(7, 'worker-host-1');
    });

    it('does not record a heartbeat when no worker name was given', async () => {
      repository.query!.mockResolvedValue([[], 0]);
      await service.claim(7);
      expect(heartbeatService.record).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('sets startedAt when moving to running', async () => {
      const job: Job = {
        id: 1,
        status: JobStatus.Claimed,
        startedAt: null,
      } as Job;
      repository.findOne!.mockResolvedValue(job);
      repository.save!.mockImplementation((j) => Promise.resolve(j));

      const result = await service.updateStatus(1, 7, {
        status: JobStatus.Running,
      });

      expect(result.status).toBe(JobStatus.Running);
      expect(result.startedAt).toBeInstanceOf(Date);
    });

    it('sets finishedAt and errorMessage when moving to failed', async () => {
      const job: Job = {
        id: 1,
        status: JobStatus.Running,
        finishedAt: null,
        errorMessage: null,
      } as Job;
      repository.findOne!.mockResolvedValue(job);
      repository.save!.mockImplementation((j) => Promise.resolve(j));

      const result = await service.updateStatus(1, 7, {
        status: JobStatus.Failed,
        errorMessage: 'boom',
      });

      expect(result.status).toBe(JobStatus.Failed);
      expect(result.finishedAt).toBeInstanceOf(Date);
      expect(result.errorMessage).toBe('boom');
    });

    it('records a job.failed log with the model and duration', async () => {
      const job = {
        id: 9,
        model: JobModel.Sonnet,
        status: JobStatus.Running,
        startedAt: new Date(Date.now() - 5000),
        finishedAt: null,
        errorMessage: null,
      } as Job;
      repository.findOne!.mockResolvedValue(job);
      repository.save!.mockImplementation((j) => Promise.resolve(j));

      await service.updateStatus(9, 7, {
        status: JobStatus.Failed,
        errorMessage: 'timed out',
      });

      expect(appLogs.record).toHaveBeenCalledTimes(1);
      expect(appLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          source: 'job',
          event: 'job.failed',
          message: 'Job 9 failed: timed out',
          meta: expect.objectContaining({ jobId: 9, model: JobModel.Sonnet }),
        }),
      );
      expect(
        (appLogs.record.mock.calls[0][0] as { meta: { durationMs: number } })
          .meta.durationMs,
      ).toBeGreaterThanOrEqual(5000);
    });

    it('does not log a job that is merely running', async () => {
      repository.findOne!.mockResolvedValue({
        id: 1,
        status: JobStatus.Claimed,
        startedAt: null,
      } as Job);
      repository.save!.mockImplementation((j) => Promise.resolve(j));

      await service.updateStatus(1, 7, { status: JobStatus.Running });

      expect(appLogs.record).not.toHaveBeenCalled();
    });

    it.each([
      [JobStatus.Claimed, JobStatus.Running],
      [JobStatus.Running, JobStatus.Succeeded],
      [JobStatus.Running, JobStatus.Failed],
    ])('allows %s -> %s', async (from, to) => {
      repository.findOne!.mockResolvedValue({
        id: 1,
        status: from,
        startedAt: null,
      } as Job);
      repository.save!.mockImplementation((j) => Promise.resolve(j));

      const result = await service.updateStatus(1, 7, {
        status: to as
          JobStatus.Running | JobStatus.Succeeded | JobStatus.Failed,
      });

      expect(result.status).toBe(to);
    });

    it.each([JobStatus.Succeeded, JobStatus.Failed])(
      'rejects any update to a %s job with ConflictException',
      async (terminal) => {
        for (const next of [
          JobStatus.Running,
          JobStatus.Succeeded,
          JobStatus.Failed,
        ] as const) {
          const job = { id: 1, status: terminal } as Job;
          repository.findOne!.mockResolvedValue(job);

          await expect(
            service.updateStatus(1, 7, { status: next }),
          ).rejects.toThrow(ConflictException);
          expect(job.status).toBe(terminal);
        }
        expect(repository.save).not.toHaveBeenCalled();
        expect(appLogs.record).not.toHaveBeenCalled();
      },
    );
  });

  describe('cancel', () => {
    const saveEcho = () =>
      repository.save!.mockImplementation((j) => Promise.resolve(j));

    it('cancels a queued job outright', async () => {
      repository.findOne!.mockResolvedValue({
        id: 4,
        model: JobModel.Gpt,
        status: JobStatus.Queued,
        logs: '',
        cancelRequestedAt: null,
      } as Job);
      saveEcho();

      const result = await service.cancel(4, 7);

      expect(result.status).toBe(JobStatus.Cancelled);
      expect(result.finishedAt).toBeInstanceOf(Date);
      expect(result.logs).toContain('stopped by the owner');
      expect(appLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'job.cancelled', level: 'warn' }),
      );
    });

    it('only requests a stop for a job a worker holds, keeping its status', async () => {
      repository.findOne!.mockResolvedValue({
        id: 5,
        status: JobStatus.Running,
        cancelRequestedAt: null,
      } as Job);
      saveEcho();

      const result = await service.cancel(5, 7);

      expect(result.status).toBe(JobStatus.Running);
      expect(result.cancelRequestedAt).toBeInstanceOf(Date);
      expect(appLogs.record).not.toHaveBeenCalled();
    });

    it('keeps the first request time when asked twice', async () => {
      const first = new Date('2026-10-08T10:00:00Z');
      repository.findOne!.mockResolvedValue({
        id: 5,
        status: JobStatus.Claimed,
        cancelRequestedAt: first,
      } as Job);
      saveEcho();

      expect((await service.cancel(5, 7)).cancelRequestedAt).toBe(first);
    });

    it('force-cancels a held job without waiting for the worker', async () => {
      repository.findOne!.mockResolvedValue({
        id: 6,
        model: JobModel.Sonnet,
        status: JobStatus.Running,
        workerName: 'gone-worker',
        logs: 'x',
        cancelRequestedAt: null,
      } as Job);
      saveEcho();

      const result = await service.cancel(6, 7, true);

      expect(result.status).toBe(JobStatus.Cancelled);
      expect(result.logs).toContain('(forced)');
    });

    it('is a no-op for an already cancelled job and refuses a finished one', async () => {
      repository.findOne!.mockResolvedValueOnce({
        id: 1,
        status: JobStatus.Cancelled,
      } as Job);
      await expect(service.cancel(1, 7)).resolves.toMatchObject({
        status: JobStatus.Cancelled,
      });
      expect(repository.save).not.toHaveBeenCalled();

      repository.findOne!.mockResolvedValueOnce({
        id: 2,
        status: JobStatus.Succeeded,
      } as Job);
      await expect(service.cancel(2, 7)).rejects.toThrow(ConflictException);
    });

    it('never lets a winding-down worker revive or fail a cancelled job', async () => {
      const job = { id: 8, status: JobStatus.Cancelled } as Job;
      repository.findOne!.mockResolvedValue(job);

      await service.updateStatus(8, 7, { status: JobStatus.Running });
      await service.updateStatus(8, 7, {
        status: JobStatus.Failed,
        errorMessage: 'killed',
      });

      expect(job.status).toBe(JobStatus.Cancelled);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it("records the worker's confirmation as cancelled with a finish time", async () => {
      repository.findOne!.mockResolvedValue({
        id: 9,
        model: JobModel.Opus,
        status: JobStatus.Running,
        finishedAt: null,
      } as Job);
      saveEcho();

      const result = await service.updateStatus(9, 7, {
        status: JobStatus.Cancelled,
      });

      expect(result.status).toBe(JobStatus.Cancelled);
      expect(result.finishedAt).toBeInstanceOf(Date);
    });

    it('rejects a result uploaded for a cancelled job', async () => {
      repository.findOne!.mockResolvedValue({
        id: 3,
        status: JobStatus.Cancelled,
      } as Job);

      await expect(
        service.setResult(3, 7, {} as Express.Multer.File),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('context', () => {
    beforeEach(() => {
      storageService.findOwned!.mockResolvedValue({
        id: 1,
        originalName: 'x.subscription.zip',
      });
      repository.save!.mockImplementation((job) =>
        Promise.resolve({ id: 9, ...job }),
      );
    });

    it('attaches nothing by default', async () => {
      const job = await service.create(7, {
        sourceFileId: 1,
        model: JobModel.Sonnet,
      });

      expect(job).toMatchObject({ contextName: null, contextText: null });
      expect(contextService.findOwned).not.toHaveBeenCalled();
    });

    it('snapshots the chosen context onto the job', async () => {
      contextService.findOwned.mockResolvedValue({
        name: 'Project notes',
        content: 'Use pnpm.',
      });

      const job = await service.create(7, {
        sourceFileId: 1,
        model: JobModel.Sonnet,
        contextId: 3,
      });

      expect(contextService.findOwned).toHaveBeenCalledWith(3, 7);
      expect(job).toMatchObject({
        contextName: 'Project notes',
        contextText: 'Use pnpm.',
      });
    });

    it('rejects a context the user does not own, creating no job', async () => {
      contextService.findOwned.mockRejectedValue(
        new NotFoundException('Context not found'),
      );

      await expect(
        service.create(7, {
          sourceFileId: 1,
          model: JobModel.Sonnet,
          contextId: 99,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('keeps the original snapshot when a job is retried', async () => {
      repository.findOne!.mockResolvedValue({
        id: 5,
        userId: 7,
        sourceFileId: 1,
        model: JobModel.Opus,
        claudeCredentialId: null,
        status: JobStatus.Failed,
        contextName: 'Project notes',
        contextText: 'Use pnpm.',
      });

      const retried = await service.retry(5, 7);

      // Not re-read from the saved context: it may have been edited or deleted.
      expect(contextService.findOwned).not.toHaveBeenCalled();
      expect(retried).toMatchObject({
        contextName: 'Project notes',
        contextText: 'Use pnpm.',
      });
    });

    describe('history of earlier runs', () => {
      const earlier = (id: number, over = {}) => ({
        id,
        model: JobModel.Sonnet,
        status: JobStatus.Failed,
        errorMessage: `error ${id}`,
        logs: `tried ${id}\n`,
        finishedAt: new Date(Date.UTC(2026, 9, id)),
        ...over,
      });

      it('mixes in nothing unless asked, and does not even look', async () => {
        const job = await service.create(7, {
          sourceFileId: 1,
          model: JobModel.Sonnet,
        });

        expect(job).toMatchObject({ historyText: null, historyCount: null });
        expect(repository.find).not.toHaveBeenCalled();
      });

      it('summarises earlier finished runs of the same task when asked', async () => {
        storageService.findOwned!.mockResolvedValue({
          id: 1,
          originalName: 'x.zip',
          taskKey: '12:34',
        });
        repository.find!.mockResolvedValue([earlier(2), earlier(1)]);

        const job = await service.create(7, {
          sourceFileId: 1,
          model: JobModel.Sonnet,
          includeHistory: true,
        });

        expect(repository.find).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ userId: 7, taskKey: '12:34' }),
          }),
        );
        expect(job).toMatchObject({ taskKey: '12:34', historyCount: 2 });
        expect(job.historyText).toContain('error 1');
        expect(job.historyText).toContain('error 2');
      });

      it('keys a plain file by the file itself', async () => {
        const job = await service.create(7, {
          sourceFileId: 1,
          model: JobModel.Sonnet,
        });

        expect(job.taskKey).toBe('file:1');
      });

      it('works with a context, without one, or with both', async () => {
        repository.find!.mockResolvedValue([earlier(1)]);
        contextService.findOwned.mockResolvedValue({
          name: 'Notes',
          content: 'Use pnpm.',
        });

        const onlyHistory = await service.create(7, {
          sourceFileId: 1,
          model: JobModel.Sonnet,
          includeHistory: true,
        });
        const both = await service.create(7, {
          sourceFileId: 1,
          model: JobModel.Sonnet,
          contextId: 3,
          includeHistory: true,
        });

        expect(onlyHistory).toMatchObject({
          contextText: null,
          historyCount: 1,
        });
        expect(both).toMatchObject({
          contextText: 'Use pnpm.',
          historyCount: 1,
        });
      });

      it('records no history when there are no earlier runs', async () => {
        repository.find!.mockResolvedValue([]);

        const job = await service.create(7, {
          sourceFileId: 1,
          model: JobModel.Sonnet,
          includeHistory: true,
        });

        expect(job).toMatchObject({ historyText: null, historyCount: null });
      });

      it('keeps the first attempt’s history when a job is retried', async () => {
        repository.findOne!.mockResolvedValue({
          id: 5,
          userId: 7,
          sourceFileId: 1,
          model: JobModel.Opus,
          claudeCredentialId: null,
          status: JobStatus.Failed,
          contextName: null,
          contextText: null,
          historyText: 'Run #1 failed.',
          historyCount: 1,
        });

        const retried = await service.retry(5, 7);

        expect(repository.find).not.toHaveBeenCalled();
        expect(retried).toMatchObject({
          historyText: 'Run #1 failed.',
          historyCount: 1,
        });
      });

      it('previews how many earlier runs there are', async () => {
        repository.find!.mockResolvedValue([earlier(1), earlier(2)]);

        await expect(service.previewHistory(7, 1)).resolves.toEqual({
          count: 2,
        });
      });
    });

    it('lists jobs without their context text', async () => {
      repository.find!.mockResolvedValue([]);
      (repository as unknown as { metadata: unknown }).metadata = {
        columns: [
          { propertyName: 'id' },
          { propertyName: 'logs' },
          { propertyName: 'contextName' },
          { propertyName: 'contextText' },
          { propertyName: 'historyText' },
        ],
      };

      await service.findAllByUser(7);

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({ select: ['id', 'contextName'] }),
      );
    });
  });

  describe('retry', () => {
    const failed = (over = {}) => ({
      id: 5,
      userId: 7,
      sourceFileId: 11,
      model: JobModel.Opus,
      claudeCredentialId: 3,
      status: JobStatus.Failed,
      errorMessage: 'boom',
      ...over,
    });

    it('queues a new job over the same parcel, model and credential', async () => {
      repository.findOne!.mockResolvedValue(failed());
      storageService.findOwned!.mockResolvedValue({
        id: 11,
        originalName: 'x.subscription.zip',
      });
      claudeCredentialsService.resolveToken!.mockResolvedValue('token');
      repository.save!.mockImplementation((job) =>
        Promise.resolve({ id: 6, ...job }),
      );

      const retried = await service.retry(5, 7);

      expect(retried).toMatchObject({
        id: 6,
        sourceFileId: 11,
        model: JobModel.Opus,
        claudeCredentialId: 3,
        status: JobStatus.Queued,
      });
      expect(appLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'job.retried' }),
      );
    });

    it('also retries a stopped job', async () => {
      repository.findOne!.mockResolvedValue(
        failed({ status: JobStatus.Cancelled }),
      );
      storageService.findOwned!.mockResolvedValue({
        id: 11,
        originalName: 'x.zip',
      });
      claudeCredentialsService.resolveToken!.mockResolvedValue('token');
      repository.save!.mockImplementation((job) => Promise.resolve(job));

      await expect(service.retry(5, 7)).resolves.toMatchObject({
        status: JobStatus.Queued,
      });
    });

    it.each([JobStatus.Queued, JobStatus.Running, JobStatus.Succeeded])(
      'refuses a %s job',
      async (status) => {
        repository.findOne!.mockResolvedValue(failed({ status }));

        await expect(service.retry(5, 7)).rejects.toThrow(ConflictException);
        expect(repository.save).not.toHaveBeenCalled();
      },
    );

    it('refuses when the parcel was already consumed', async () => {
      repository.findOne!.mockResolvedValue(failed({ sourceFileId: null }));

      await expect(service.retry(5, 7)).rejects.toThrow(ConflictException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('does not retry someone else’s job', async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(service.retry(5, 8)).rejects.toThrow(NotFoundException);
    });
  });

  describe('appendLog', () => {
    it('appends the chunk to existing logs', async () => {
      const job: Job = { id: 1, logs: 'line 1\n' } as Job;
      repository.findOne!.mockResolvedValue(job);
      repository.save!.mockImplementation((j) => Promise.resolve(j));

      await service.appendLog(1, 7, 'line 2\n');

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ logs: 'line 1\nline 2\n' }),
      );
    });
  });

  describe('setResult', () => {
    it('creates a StoredFile, links it, and marks the job succeeded', async () => {
      const job: Job = {
        id: 1,
        sourceFileId: 5,
        resultFileId: null,
        status: JobStatus.Running,
      } as Job;
      repository.findOne!.mockResolvedValue(job);
      storageService.findOwned!.mockResolvedValue({
        id: 5,
        channel: null,
        taskKey: null,
      });
      storageService.create!.mockResolvedValue({ id: 99 });
      repository.save!.mockImplementation((j) => Promise.resolve(j));

      const file = { originalname: 'result.zip' } as Express.Multer.File;
      const result = await service.setResult(1, 7, file);

      expect(storageService.create).toHaveBeenCalledWith(7, file, {});
      expect(result.resultFileId).toBe(99);
      expect(result.status).toBe(JobStatus.Succeeded);
      expect(result.finishedAt).toBeInstanceOf(Date);
    });

    // Regression test: a Worker job run against an issue parcel (pushed by
    // sync's push-issue or reports' Subscription) produced a result only
    // ever retrievable through the Worker page — pull-issue/reports'
    // Subscription pull had no way to find it, since it carried none of the
    // source parcel's own channel/taskKey addressing (IMPROVEMENTS_TECH.md
    // 2.3's read side only knew about agent-runner's results).
    it("propagates the source file's channel/taskKey onto the result, as direction:'result'", async () => {
      const job: Job = {
        id: 1,
        sourceFileId: 5,
        resultFileId: null,
        status: JobStatus.Running,
      } as Job;
      repository.findOne!.mockResolvedValue(job);
      storageService.findOwned!.mockResolvedValue({
        id: 5,
        channel: 'issue',
        taskKey: '402:6',
      });
      storageService.create!.mockResolvedValue({ id: 99 });
      repository.save!.mockImplementation((j) => Promise.resolve(j));

      const file = { originalname: 'result.zip' } as Express.Multer.File;
      await service.setResult(1, 7, file);

      expect(storageService.create).toHaveBeenCalledWith(7, file, {
        channel: 'issue',
        taskKey: '402:6',
        direction: 'result',
      });
    });

    describe('consuming the source parcel', () => {
      function setup(sourceFile: Record<string, unknown>) {
        const job = {
          id: 1,
          sourceFileId: 5,
          resultFileId: null,
          status: JobStatus.Running,
        } as Job;
        repository.findOne!.mockResolvedValue(job);
        storageService.findOwned!.mockResolvedValue(sourceFile);
        storageService.create!.mockResolvedValue({ id: 99 });
        storageService.delete = jest.fn().mockResolvedValue(undefined);
        repository.save!.mockImplementation((j) => Promise.resolve(j));

        return job;
      }

      const file = { originalname: 'result.zip' } as Express.Multer.File;

      it('deletes a pipeline parcel (one with a taskKey) and unlinks it from the job', async () => {
        const source = { id: 5, channel: 'issue', taskKey: '402:6' };
        setup(source);

        const result = await service.setResult(1, 7, file);

        expect(result.sourceFileId).toBeNull();
        expect(storageService.delete).toHaveBeenCalledWith(source);
      });

      it('saves the job before deleting, so the delete cannot orphan the link', async () => {
        setup({ id: 5, channel: 'issue', taskKey: '402:6' });
        const order: string[] = [];
        repository.save!.mockImplementation((j) => {
          order.push('save');
          return Promise.resolve(j);
        });
        (storageService.delete as jest.Mock).mockImplementation(async () => {
          order.push('delete');
        });

        await service.setResult(1, 7, file);

        expect(order).toEqual(['save', 'delete']);
      });

      it('leaves a hand-uploaded file (no taskKey) alone', async () => {
        setup({ id: 5, channel: null, taskKey: null });

        const result = await service.setResult(1, 7, file);

        expect(result.sourceFileId).toBe(5);
        expect(storageService.delete).not.toHaveBeenCalled();
      });

      it('still succeeds when the delete itself fails', async () => {
        setup({ id: 5, channel: 'issue', taskKey: '402:6' });
        (storageService.delete as jest.Mock).mockRejectedValue(
          new Error('disk'),
        );

        const result = await service.setResult(1, 7, file);

        expect(result.status).toBe(JobStatus.Succeeded);
        expect(result.resultFileId).toBe(99);
      });
    });
  });
});
