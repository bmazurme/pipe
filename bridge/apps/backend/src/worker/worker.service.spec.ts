import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { ContextUsageRegistry } from '../context/context-usage';
import { ContextService } from '../context/context.service';
import { AppLogService } from '../logs/app-log.service';
import { StorageService } from '../storage/storage.service';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { Job, JobModel, JobStatus } from './entities/job.entity';
import { buildRunHistory, LOG_TAIL_CHARS } from './run-history';
import type { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { JobResponseDto } from './dto/job-response.dto';
import { Worker } from './entities/worker.entity';
import { JobFinishNotifier } from './job-finish-notifier';
import { JobSweepService } from './job-sweep.service';
import { ProviderCredentialsService } from './provider-credentials.service';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerService } from './worker.service';

const LOST_MESSAGE_TEXT =
  'Worker was restarted or lost while this job was running — the run did not finish';

type MockRepository = Partial<Record<keyof Repository<Job>, jest.Mock>>;

function createMockRepository(): MockRepository {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    query: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

// A chainable stand-in for the UPDATE query builder; `execute` resolves with the
// given affected-row count.
function mockUpdateBuilder(repository: MockRepository, affected: number) {
  const builder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected }),
  };
  repository.createQueryBuilder!.mockReturnValue(builder);
  return builder;
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
  let workerRepository: {
    findOneBy: jest.Mock;
    update: jest.Mock;
  };
  let providerCredentials: {
    existsFor: jest.Mock;
    resolveForJob: jest.Mock;
  };

  beforeEach(async () => {
    repository = createMockRepository();
    storageService = {
      findOwned: jest.fn(),
      create: jest.fn(),
      download: jest.fn(),
    };
    claudeCredentialsService = {
      resolveToken: jest.fn(),
      recordLimits: jest.fn(),
      markAuthFailed: jest.fn(),
      clearAuthFailed: jest.fn(),
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
    workerRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    };
    providerCredentials = {
      existsFor: jest.fn().mockResolvedValue(true),
      resolveForJob: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerService,
        JobSweepService,
        { provide: JobFinishNotifier, useValue: { notify: jest.fn() } },
        { provide: getRepositoryToken(Job), useValue: repository },
        { provide: StorageService, useValue: storageService },
        {
          provide: ClaudeCredentialsService,
          useValue: claudeCredentialsService,
        },
        { provide: WorkerHeartbeatService, useValue: heartbeatService },
        { provide: AppLogService, useValue: appLogs },
        { provide: ContextService, useValue: contextService },
        { provide: ContextUsageRegistry, useValue: { register: jest.fn() } },
        { provide: getRepositoryToken(Worker), useValue: workerRepository },
        {
          provide: ProviderCredentialsService,
          useValue: providerCredentials,
        },
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

    it('with updatedAfter asks only for the jobs that changed since then', async () => {
      const since = new Date('2026-10-16T12:00:00.000Z');

      await service.findAllByUser(7, since);

      const options = repository.find!.mock.calls[0][0] as {
        where: { userId: number; updatedAt: { _type: string; _value: Date } };
      };

      expect(options.where.userId).toBe(7);
      expect(options.where.updatedAt._type).toBe('moreThan');
      expect(options.where.updatedAt._value).toEqual(since);
    });

    it('without it adds no time condition', async () => {
      await service.findAllByUser(7);

      expect(repository.find!.mock.calls[0][0]).toMatchObject({
        where: { userId: 7 },
      });
      expect(
        (repository.find!.mock.calls[0][0] as { where: object }).where,
      ).not.toHaveProperty('updatedAt');
    });
  });

  describe('findStatuses', () => {
    it('selects only the status fields, never logs or context/history', async () => {
      repository.find!.mockResolvedValue([]);

      await service.findStatuses([3, 4]);

      const options = repository.find!.mock.calls[0][0] as {
        select: string[];
      };
      expect(options.select).toEqual([
        'id',
        'userId',
        'status',
        'resultFileId',
        'errorMessage',
      ]);
      expect(options.select).not.toContain('logs');
    });

    it('skips the query for no ids', async () => {
      await expect(service.findStatuses([])).resolves.toEqual([]);
      expect(repository.find).not.toHaveBeenCalled();
    });
  });

  describe('findRetriesOf', () => {
    it('finds the newest later job over the same parcel and the same owner', async () => {
      repository
        .find!.mockResolvedValueOnce([
          { id: 102, userId: 3, sourceFileId: 50 },
          { id: 90, userId: 3, sourceFileId: null },
        ])
        .mockResolvedValueOnce([
          { id: 105, userId: 3, sourceFileId: 50 },
          { id: 104, userId: 9, sourceFileId: 50 },
          { id: 102, userId: 3, sourceFileId: 50 },
        ]);

      const retries = await service.findRetriesOf([102, 90]);

      expect(retries.get(102)?.id).toBe(105);
      expect(retries.has(90)).toBe(false);
    });

    it('skips the queries for no ids', async () => {
      await expect(service.findRetriesOf([])).resolves.toEqual(new Map());
      expect(repository.find).not.toHaveBeenCalled();
    });
  });

  describe('findOwnedWithLogsFrom', () => {
    function mockSelectBuilder(result: {
      entities: Partial<Job>[];
      raw: { logsTail: string | null; logsLength: number }[];
    }) {
      const builder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        getRawAndEntities: jest.fn().mockResolvedValue(result),
      };
      repository.createQueryBuilder!.mockReturnValue(builder);
      return builder;
    }

    it('returns the log after logsFrom and its full length, for the owner', async () => {
      const job = { id: 3, userId: 7, status: JobStatus.Running };
      const builder = mockSelectBuilder({
        entities: [job],
        raw: [{ logsTail: 'second chunk\n', logsLength: 25 }],
      });

      await expect(service.findOwnedWithLogsFrom(3, 7, 12)).resolves.toEqual({
        job,
        logsTail: 'second chunk\n',
        logsLength: 25,
      });

      // SUBSTRING is 1-based: skipping 12 characters starts at the 13th.
      expect(builder.setParameter).toHaveBeenCalledWith('logsStart', 13);
      expect(builder.where).toHaveBeenCalledWith(expect.any(String), {
        id: 3,
        userId: 7,
      });
    });

    it('never selects the whole log or the context/history text', async () => {
      const builder = mockSelectBuilder({
        entities: [{ id: 3 }],
        raw: [{ logsTail: '', logsLength: 0 }],
      });

      await service.findOwnedWithLogsFrom(3, 7, 0);

      const columns = builder.select.mock.calls[0][0] as string[];
      expect(columns).toContain('job.id');
      expect(columns).toContain('job.status');
      expect(columns).not.toContain('job.logs');
      expect(columns).not.toContain('job.contextText');
      expect(columns).not.toContain('job.historyText');
    });

    it('treats a missing tail as an empty one', async () => {
      mockSelectBuilder({
        entities: [{ id: 3 }],
        raw: [{ logsTail: null, logsLength: 0 }],
      });

      await expect(service.findOwnedWithLogsFrom(3, 7, 40)).resolves.toEqual(
        expect.objectContaining({ logsTail: '', logsLength: 0 }),
      );
    });

    it('throws NotFoundException for a missing or foreign job', async () => {
      mockSelectBuilder({ entities: [], raw: [] });

      await expect(service.findOwnedWithLogsFrom(3, 7, 0)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getCancelState', () => {
    it('selects only id, status and cancelRequestedAt for the owner', async () => {
      const row = { id: 3, status: JobStatus.Running, cancelRequestedAt: null };
      repository.findOne!.mockResolvedValue(row);

      await expect(service.getCancelState(3, 7)).resolves.toEqual(row);

      expect(repository.findOne).toHaveBeenCalledWith({
        select: { id: true, status: true, cancelRequestedAt: true },
        where: { id: 3, userId: 7 },
      });
    });

    it('throws NotFoundException for a missing or foreign job', async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(service.getCancelState(3, 7)).rejects.toThrow(
        NotFoundException,
      );
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

    it('keeps the public key the result is to be encrypted with', async () => {
      storageService.findOwned!.mockResolvedValue({
        id: 1,
        originalName: '402-6.subscription.zip',
      });
      repository.save!.mockImplementation((job) =>
        Promise.resolve({ id: 10, ...job }),
      );
      const resultPublicKey =
        '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----';

      await service.create(7, {
        sourceFileId: 1,
        model: JobModel.Deepseek,
        resultPublicKey,
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ resultPublicKey }),
      );
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
        providerCredentialId: null,
        targetWorkerId: null,
        requiredCapability: null,
        notBefore: null,
        timeoutSec: null,
        notifyOnFinish: false,
        resultPublicKey: null,
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

    it('stores a requested notBefore, and null when absent', async () => {
      storageService.findOwned!.mockResolvedValue({
        id: 1,
        originalName: '402-6.subscription.zip',
      });
      repository.save!.mockImplementation((job) =>
        Promise.resolve({ id: 10, ...job }),
      );
      const later = new Date(Date.now() + 3_600_000);

      await service.create(7, {
        sourceFileId: 1,
        model: JobModel.Gpt,
        notBefore: later,
      });
      expect(repository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ notBefore: later }),
      );

      await service.create(7, { sourceFileId: 1, model: JobModel.Gpt });
      expect(repository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ notBefore: null }),
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
      const lost = stale({ status: JobStatus.Failed, errorMessage: 'lost' });
      repository.query!.mockResolvedValueOnce([[lost], 1]);
      repository.query!.mockResolvedValueOnce([[], 0]);

      await service.claim(7, 'swarm-worker');

      const [sql, params] = repository.query!.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('UPDATE jobs SET');
      expect(sql).toContain('status IN');
      expect(params).toContain(JobStatus.Failed);
      expect(params).toContain(LOST_MESSAGE_TEXT);
      expect(repository.save).not.toHaveBeenCalled();
      expect(appLogs.record).toHaveBeenCalledTimes(1);
      expect(appLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'job.failed' }),
      );
    });

    it("only touches this worker's own silent jobs", async () => {
      repository.query!.mockResolvedValue([[], 0]);

      await service.claim(7, 'swarm-worker');

      const [sql, params] = repository.query!.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('"userId" = $7');
      expect(sql).toContain('"workerName" = $8');
      expect(params.slice(6)).toEqual([7, 'swarm-worker']);
      // 10 minutes of silence, expressed as an updatedAt cutoff.
      const cutoff = params[3] as Date;
      expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(10 * 60_000);
    });

    it('does nothing without a worker name', async () => {
      repository.query!.mockResolvedValue([[], 0]);

      await service.claim(7);

      expect(repository.query).toHaveBeenCalledTimes(1);
      expect(repository.query!.mock.calls[0][0]).not.toContain('errorMessage');
    });

    it('still claims from the queue when the orphan sweep throws', async () => {
      repository.query!.mockRejectedValueOnce(new Error('db hiccup'));
      repository.query!.mockResolvedValueOnce([[{ id: 42 }], 1]);
      repository.findOneBy!.mockResolvedValue({
        id: 42,
        status: JobStatus.Claimed,
      });

      const job = await service.claim(7, 'swarm-worker');

      expect(job).toMatchObject({ id: 42, status: JobStatus.Claimed });
      expect(repository.query).toHaveBeenCalledTimes(2);
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
        [JobStatus.Claimed, 'worker-host-1', JobStatus.Queued, 7, null],
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
    describe('rejected Claude token', () => {
      const run = (
        status: UpdateJobStatusDto['status'],
        errorMessage?: string,
      ) => {
        repository.findOne!.mockResolvedValue({
          id: 4,
          status: JobStatus.Running,
          usedClaudeCredentialId: 12,
        } as Job);
        repository.save!.mockImplementation((j) => Promise.resolve(j));

        return service.updateStatus(4, 7, { status, errorMessage });
      };

      it('marks the token a job failed to authenticate on', async () => {
        await run(
          JobStatus.Failed,
          'Model run exited with code 1: Failed to authenticate. API Error: 403 Request not allowed',
        );

        expect(claudeCredentialsService.markAuthFailed).toHaveBeenCalledWith(
          12,
          7,
          4,
        );
      });

      it('leaves the token alone for any other failure', async () => {
        await run(
          JobStatus.Failed,
          'Model run exited with code 1: out of memory',
        );

        expect(claudeCredentialsService.markAuthFailed).not.toHaveBeenCalled();
      });

      it('clears the mark when a job on the token succeeds', async () => {
        await run(JobStatus.Succeeded);

        expect(claudeCredentialsService.clearAuthFailed).toHaveBeenCalledWith(
          12,
          7,
        );
      });
    });

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

  describe('appendLog', () => {
    it('appends with one atomic UPDATE, bumping updatedAt, without loading the job', async () => {
      const builder = mockUpdateBuilder(repository, 1);

      await service.appendLog(5, 7, 'chunk\n');

      expect(builder.execute).toHaveBeenCalledTimes(1);
      const set = builder.set.mock.calls[0][0] as {
        logs: () => string;
        updatedAt: () => string;
      };
      expect(set.logs()).toContain('logs ||');
      expect(set.updatedAt()).toBe('now()');
      expect(builder.setParameter).toHaveBeenCalledWith('chunk', 'chunk\n');
      expect(builder.where).toHaveBeenCalledWith(
        expect.stringContaining('"userId"'),
        { id: 5, userId: 7 },
      );
      expect(repository.findOne).not.toHaveBeenCalled();
      expect(repository.findOneBy).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown or foreign job, loading nothing', async () => {
      const builder = mockUpdateBuilder(repository, 0);

      await expect(service.appendLog(5, 999, 'x')).rejects.toThrow(
        NotFoundException,
      );

      expect(builder.where).toHaveBeenCalledWith(expect.any(String), {
        id: 5,
        userId: 999,
      });
      expect(repository.findOne).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('issues an independent UPDATE per concurrent append', async () => {
      const builder = mockUpdateBuilder(repository, 1);

      await Promise.all([
        service.appendLog(5, 7, 'a'),
        service.appendLog(5, 7, 'b'),
      ]);

      expect(builder.execute).toHaveBeenCalledTimes(2);
      expect(builder.setParameter).toHaveBeenCalledWith('chunk', 'a');
      expect(builder.setParameter).toHaveBeenCalledWith('chunk', 'b');
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels a queued job outright with one conditional UPDATE', async () => {
      repository.findOne!.mockResolvedValue({
        id: 4,
        model: JobModel.Gpt,
        status: JobStatus.Queued,
        workerName: null,
      } as Job);
      repository.query!.mockResolvedValue([
        [{ id: 4, model: JobModel.Gpt, status: JobStatus.Cancelled }],
        1,
      ]);

      const result = await service.cancel(4, 7);

      expect(result.status).toBe(JobStatus.Cancelled);
      expect(repository.query).toHaveBeenCalledTimes(1);
      const [sql, params] = repository.query!.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('UPDATE jobs SET');
      expect(sql).toContain('status IN');
      expect(params).toContain('\n[stopped by the owner]\n');
      expect(repository.save).not.toHaveBeenCalled();
      expect(appLogs.record).toHaveBeenCalledTimes(1);
      expect(appLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'job.cancelled', level: 'warn' }),
      );
    });

    it('only requests a stop for a job a worker holds, with a targeted update', async () => {
      const job = {
        id: 5,
        status: JobStatus.Running,
        cancelRequestedAt: null,
      } as Job;
      repository.findOne!.mockResolvedValue(job);
      const builder = mockUpdateBuilder(repository, 1);

      const result = await service.cancel(5, 7);

      expect(result.status).toBe(JobStatus.Running);
      expect(builder.execute).toHaveBeenCalledTimes(1);
      const set = builder.set.mock.calls[0][0] as {
        cancelRequestedAt: () => string;
      };
      expect(set.cancelRequestedAt()).toContain('COALESCE');
      expect(Object.keys(builder.set.mock.calls[0][0] as object)).toEqual([
        'cancelRequestedAt',
      ]);
      expect(repository.save).not.toHaveBeenCalled();
      expect(repository.query).not.toHaveBeenCalled();
      expect(appLogs.record).not.toHaveBeenCalled();
    });

    it('force-cancels a held job with the (forced) suffix, without save', async () => {
      repository.findOne!.mockResolvedValue({
        id: 6,
        model: JobModel.Sonnet,
        status: JobStatus.Running,
        workerName: 'gone-worker',
      } as Job);
      repository.query!.mockResolvedValue([
        [{ id: 6, model: JobModel.Sonnet, status: JobStatus.Cancelled }],
        1,
      ]);

      const result = await service.cancel(6, 7, true);

      expect(result.status).toBe(JobStatus.Cancelled);
      expect(repository.query).toHaveBeenCalledTimes(1);
      expect(repository.query!.mock.calls[0][1]).toContain(
        '\n[stopped by the owner (forced)]\n',
      );
      expect(repository.save).not.toHaveBeenCalled();
      expect(appLogs.record).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when the job succeeded before the UPDATE ran', async () => {
      repository
        .findOne!.mockResolvedValueOnce({
          id: 6,
          status: JobStatus.Running,
          workerName: 'w',
        } as Job)
        .mockResolvedValueOnce({ id: 6, status: JobStatus.Succeeded } as Job);
      repository.query!.mockResolvedValue([[], 0]);

      await expect(service.cancel(6, 7, true)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.save).not.toHaveBeenCalled();
      expect(appLogs.record).not.toHaveBeenCalled();
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
      repository.save!.mockImplementation((j) => Promise.resolve(j));

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

    describe('retry with another context', () => {
      const failed = () => ({
        id: 5,
        userId: 7,
        sourceFileId: 1,
        model: JobModel.Opus,
        claudeCredentialId: null,
        status: JobStatus.Failed,
        contextName: 'Project notes',
        contextText: 'Use pnpm.',
      });

      it('snapshots the chosen context instead of the old one', async () => {
        repository.findOne!.mockResolvedValue(failed());
        contextService.findOwned.mockResolvedValue({
          name: 'Ответы: 1:2',
          content: 'Answer text',
        });

        const retried = await service.retry(5, 7, undefined, { contextId: 4 });

        expect(contextService.findOwned).toHaveBeenCalledWith(4, 7);
        expect(retried).toMatchObject({
          contextName: 'Ответы: 1:2',
          contextText: 'Answer text',
        });
      });

      it('drops the context when asked to run without one', async () => {
        repository.findOne!.mockResolvedValue(failed());

        const retried = await service.retry(5, 7, undefined, {
          withoutContext: true,
        });

        expect(contextService.findOwned).not.toHaveBeenCalled();
        expect(retried).toMatchObject({
          contextName: null,
          contextText: null,
        });
      });

      it('rejects a context the user does not own, creating no job', async () => {
        repository.findOne!.mockResolvedValue(failed());
        contextService.findOwned.mockRejectedValue(
          new NotFoundException('Context not found'),
        );

        await expect(
          service.retry(5, 7, undefined, { contextId: 99 }),
        ).rejects.toThrow(NotFoundException);
        expect(repository.save).not.toHaveBeenCalled();
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

      let historyBuilder: {
        select: jest.Mock;
        addSelect: jest.Mock;
        where: jest.Mock;
        setParameter: jest.Mock;
        orderBy: jest.Mock;
        addOrderBy: jest.Mock;
        limit: jest.Mock;
        getRawAndEntities: jest.Mock;
      };

      // The history query reads only a few columns plus the end of the log, as `logsTail`.
      const mockHistory = (rows: ReturnType<typeof earlier>[]) => {
        historyBuilder = {
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          setParameter: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          addOrderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          getRawAndEntities: jest.fn().mockResolvedValue({
            entities: rows.map((row) => ({ ...row, logs: undefined })),
            raw: rows.map((row) => ({
              logsTail: row.logs.slice(-LOG_TAIL_CHARS),
            })),
          }),
        };
        repository.createQueryBuilder!.mockReturnValue(historyBuilder);
      };

      it('mixes in nothing unless asked, and does not even look', async () => {
        const job = await service.create(7, {
          sourceFileId: 1,
          model: JobModel.Sonnet,
        });

        expect(job).toMatchObject({ historyText: null, historyCount: null });
        expect(repository.createQueryBuilder).not.toHaveBeenCalled();
      });

      it('summarises earlier finished runs of the same task when asked', async () => {
        storageService.findOwned!.mockResolvedValue({
          id: 1,
          originalName: 'x.zip',
          taskKey: '12:34',
        });
        mockHistory([earlier(2), earlier(1)]);

        const job = await service.create(7, {
          sourceFileId: 1,
          model: JobModel.Sonnet,
          includeHistory: true,
        });

        expect(historyBuilder.where).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ userId: 7, taskKey: '12:34' }),
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
        mockHistory([earlier(1)]);
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
        mockHistory([]);

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

        expect(repository.createQueryBuilder).not.toHaveBeenCalled();
        expect(retried).toMatchObject({
          historyText: 'Run #1 failed.',
          historyCount: 1,
        });
      });

      it('previews how many earlier runs there are', async () => {
        mockHistory([earlier(1), earlier(2)]);

        await expect(service.previewHistory(7, 1)).resolves.toEqual({
          count: 2,
        });
      });

      it('reads only the status fields and the end of the log', async () => {
        mockHistory([earlier(1)]);

        await service.previewHistory(7, 1);

        const selected = JSON.stringify([
          ...historyBuilder.select.mock.calls,
          ...historyBuilder.addSelect.mock.calls,
        ]);

        expect(selected).not.toContain('contextText');
        expect(selected).not.toContain('historyText');
        expect(selected).not.toContain('job.logs');
        expect(selected).toContain('RIGHT(');
        expect(historyBuilder.setParameter).toHaveBeenCalledWith(
          'logTail',
          LOG_TAIL_CHARS,
        );
      });

      it('builds the same history from a tail-truncated log as from the full one', async () => {
        const full = `${'old line\n'.repeat(5_000)}${'x'.repeat(500)}\nthe end\n`;

        mockHistory([earlier(1, { logs: full })]);

        const truncated = await service.previewHistory(7, 1);
        const fromTail = buildRunHistory([
          { ...earlier(1), logs: full.slice(-LOG_TAIL_CHARS) } as never,
        ]);
        const fromFull = buildRunHistory([
          { ...earlier(1), logs: full } as never,
        ]);

        expect(truncated.count).toBe(1);
        expect(fromTail).toEqual(fromFull);
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

  describe('retryAfterInfraFailure', () => {
    const lost = (over = {}) =>
      ({
        id: 5,
        userId: 7,
        sourceFileId: 11,
        model: JobModel.Opus,
        claudeCredentialId: 3,
        status: JobStatus.Failed,
        errorMessage: LOST_MESSAGE_TEXT,
        ...over,
      }) as Job;

    beforeEach(() => {
      repository.count = jest.fn().mockResolvedValue(0);
      repository.findOne!.mockResolvedValue(lost());
      storageService.findOwned!.mockResolvedValue({
        id: 11,
        originalName: 'x.subscription.zip',
      });
      claudeCredentialsService.resolveToken!.mockResolvedValue('token');
      repository.save!.mockImplementation((job) =>
        Promise.resolve({ id: 6, ...job }),
      );
    });

    it('queues one new job on the same parcel, model and credential', async () => {
      const retried = await service.retryAfterInfraFailure(lost());

      expect(retried).toMatchObject({
        id: 6,
        sourceFileId: 11,
        model: JobModel.Opus,
        claudeCredentialId: 3,
        status: JobStatus.Queued,
      });
      expect(appLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'job.auto_retried' }),
      );
    });

    it('retries a job the worker reported as stopped by SIGTERM', async () => {
      const shutdown =
        'Worker was stopped (SIGTERM) before the job finished — start it again';
      repository.findOne!.mockResolvedValue(
        lost({ status: JobStatus.Running, errorMessage: null }),
      );

      await service.updateStatus(5, 7, {
        status: JobStatus.Failed,
        errorMessage: shutdown,
      });

      expect(repository.save).toHaveBeenCalledTimes(2);
      expect(appLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'job.auto_retried' }),
      );
    });

    it('retries a job reported with failureKind shutdown whatever the text', async () => {
      repository.findOne!.mockResolvedValue(
        lost({ status: JobStatus.Running, errorMessage: null }),
      );

      await service.updateStatus(5, 7, {
        status: JobStatus.Failed,
        errorMessage: 'Worker stopped',
        failureKind: 'shutdown',
      });

      expect(repository.save).toHaveBeenCalledTimes(2);
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ failureKind: 'shutdown' }),
      );
    });

    it('retries a job with failureKind lost whatever the text', async () => {
      const retried = await service.retryAfterInfraFailure(
        lost({ errorMessage: 'anything', failureKind: 'lost' }),
      );

      expect(retried).toMatchObject({ status: JobStatus.Queued });
    });

    it('does not retry twice when the earlier attempt only has a failureKind', async () => {
      repository.count!.mockResolvedValue(1);

      const retried = await service.retryAfterInfraFailure(
        lost({ failureKind: 'shutdown', errorMessage: 'x' }),
      );

      expect(retried).toBeNull();
      expect(repository.count).toHaveBeenCalledWith({
        where: expect.arrayContaining([
          expect.objectContaining({ failureKind: expect.anything() }),
        ]),
      });
    });

    it('never retries a job that failed for another reason', async () => {
      const retried = await service.retryAfterInfraFailure(
        lost({ errorMessage: 'claude exited with code 1' }),
      );

      expect(retried).toBeNull();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('does not retry twice for the same parcel', async () => {
      repository.count!.mockResolvedValue(1);

      const retried = await service.retryAfterInfraFailure(lost());

      expect(retried).toBeNull();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('skips quietly when the parcel is gone', async () => {
      const retried = await service.retryAfterInfraFailure(
        lost({ sourceFileId: null }),
      );

      expect(retried).toBeNull();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('re-queues a job the sweep failed when a worker asks for work', async () => {
      repository.query!.mockResolvedValueOnce([[lost()], 1]);
      repository.query!.mockResolvedValueOnce([[], 0]);

      await service.claim(7, 'swarm-worker');

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceFileId: 11,
          status: JobStatus.Queued,
        }),
      );
    });
  });

  describe('delayed start (notBefore)', () => {
    it('claim only picks queued jobs whose notBefore is empty or already past', async () => {
      repository.query!.mockResolvedValue([[], 0]);

      await service.claim(7, 'worker-host-1');

      expect(repository.query).toHaveBeenCalledWith(
        expect.stringContaining(
          '("notBefore" IS NULL OR "notBefore" <= now())',
        ),
        expect.any(Array),
      );
    });

    it('retry copies notBefore to the new queued job', async () => {
      const notBefore = new Date(Date.now() + 3_600_000);
      repository.findOne!.mockResolvedValue({
        id: 5,
        userId: 7,
        sourceFileId: 11,
        model: JobModel.Opus,
        claudeCredentialId: 3,
        status: JobStatus.Failed,
        errorMessage: "You've hit your session limit",
      });
      storageService.findOwned!.mockResolvedValue({
        id: 11,
        originalName: 'x.zip',
      });
      claudeCredentialsService.resolveToken!.mockResolvedValue('token');
      repository.save!.mockImplementation((job) => Promise.resolve(job));

      await expect(service.retry(5, 7, notBefore)).resolves.toMatchObject({
        status: JobStatus.Queued,
        notBefore,
      });
    });

    it('retry without notBefore queues the job for right away', async () => {
      repository.findOne!.mockResolvedValue({
        id: 5,
        userId: 7,
        sourceFileId: 11,
        model: JobModel.Opus,
        claudeCredentialId: 3,
        status: JobStatus.Failed,
        errorMessage: 'boom',
      });
      storageService.findOwned!.mockResolvedValue({
        id: 11,
        originalName: 'x.zip',
      });
      claudeCredentialsService.resolveToken!.mockResolvedValue('token');
      repository.save!.mockImplementation((job) => Promise.resolve(job));

      await expect(service.retry(5, 7)).resolves.toMatchObject({
        notBefore: null,
      });
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

  describe('job time limit (timeoutSec)', () => {
    beforeEach(() => {
      storageService.findOwned!.mockResolvedValue({
        id: 11,
        originalName: 'x.subscription.zip',
      });
      repository.save!.mockImplementation((job) =>
        Promise.resolve({ id: 6, ...job }),
      );
    });

    it('stores the limit chosen at launch', async () => {
      const job = await service.create(7, {
        sourceFileId: 11,
        model: JobModel.Gpt,
        timeoutSec: 7200,
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutSec: 7200 }),
      );
      expect(JobResponseDto.fromEntity(job as Job).timeoutSec).toBe(7200);
    });

    it('a retry keeps the original job’s limit', async () => {
      repository.findOne!.mockResolvedValue({
        id: 5,
        userId: 7,
        sourceFileId: 11,
        model: JobModel.Gpt,
        claudeCredentialId: null,
        providerCredentialId: null,
        targetWorkerId: null,
        timeoutSec: 7200,
        status: JobStatus.Failed,
      });

      await expect(service.retry(5, 7)).resolves.toMatchObject({
        timeoutSec: 7200,
      });
    });

    it('a retry of a job without a limit stays without one', async () => {
      repository.findOne!.mockResolvedValue({
        id: 5,
        userId: 7,
        sourceFileId: 11,
        model: JobModel.Gpt,
        claudeCredentialId: null,
        providerCredentialId: null,
        targetWorkerId: null,
        timeoutSec: null,
        status: JobStatus.Failed,
      });

      await expect(service.retry(5, 7)).resolves.toMatchObject({
        timeoutSec: null,
      });
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

  describe('workers added in the UI', () => {
    const managed = (over: Record<string, unknown> = {}) => ({
      id: 5,
      userId: 7,
      name: 'green',
      enabled: true,
      models: null,
      ...over,
    });
    const claimSql = () =>
      (repository.query as jest.Mock).mock.calls
        .map((call: unknown[]) => call[0] as string)
        .find((sql) => sql.includes('SKIP LOCKED')) ?? '';
    const claimParams = () =>
      ((repository.query as jest.Mock).mock.calls.find((call: unknown[]) =>
        (call[0] as string).includes('SKIP LOCKED'),
      ) ?? [])[1] as unknown[];

    beforeEach(() => {
      repository.query!.mockResolvedValue([[], 0]);
    });

    describe('claim', () => {
      it('a legacy worker (personal API key) never takes a job pinned to a specific worker', async () => {
        await service.claim(7, 'old-worker');

        expect(claimSql()).toContain('"targetWorkerId" IS NULL');
        expect(claimSql()).not.toContain('"targetWorkerId" = $5');
      });

      it('a managed worker takes unpinned jobs and the ones pinned to it, and records which worker claimed', async () => {
        workerRepository.findOneBy.mockResolvedValue(managed());

        await service.claim(7, undefined, 5);

        expect(claimSql()).toContain(
          '("targetWorkerId" IS NULL OR "targetWorkerId" = $5)',
        );
        expect(claimSql()).toContain('"workerId" = $5');
        expect(claimParams()).toEqual([
          JobStatus.Claimed,
          'green',
          JobStatus.Queued,
          7,
          5,
          [],
        ]);
      });

      it('a managed worker uses the name stored for it, not one it reports', async () => {
        workerRepository.findOneBy.mockResolvedValue(managed());

        await service.claim(7, 'something-else', 5);

        expect(claimParams()[1]).toBe('green');
        expect(heartbeatService.record).not.toHaveBeenCalled();
      });

      it('only takes the models it is set up for', async () => {
        workerRepository.findOneBy.mockResolvedValue(
          managed({ models: [JobModel.Gpt, JobModel.Qwen] }),
        );

        await service.claim(7, undefined, 5);

        expect(claimSql()).toContain('model::text = ANY($6::text[])');
        expect(claimParams()[5]).toEqual([JobModel.Gpt, JobModel.Qwen]);
      });

      it('takes any model when none were restricted', async () => {
        workerRepository.findOneBy.mockResolvedValue(managed());

        await service.claim(7, undefined, 5);

        expect(claimSql()).not.toContain('model::text = ANY(');
      });

      it('hands a job that requires a capability only to a worker that has it', async () => {
        workerRepository.findOneBy.mockResolvedValue(
          managed({ capabilities: ['fusion'] }),
        );

        await service.claim(7, undefined, 5);

        expect(claimSql()).toContain(
          '("requiredCapability" IS NULL OR "requiredCapability" = ANY($6::text[]))',
        );
        expect(claimParams()[5]).toEqual(['fusion']);
      });

      it('a legacy worker never takes a job that requires a capability', async () => {
        await service.claim(7, 'old');

        expect(claimSql()).toContain('"requiredCapability" IS NULL');
        expect(claimSql()).not.toContain('"requiredCapability" = ANY');
      });

      it('a paused worker is given nothing — and nothing is claimed', async () => {
        workerRepository.findOneBy.mockResolvedValue(
          managed({ enabled: false }),
        );

        await expect(service.claim(7, undefined, 5)).resolves.toBeNull();
        expect(claimSql()).toBe('');
      });

      it('a worker that was deleted in the meantime is given nothing', async () => {
        workerRepository.findOneBy.mockResolvedValue(null);

        await expect(service.claim(7, undefined, 5)).resolves.toBeNull();
        expect(claimSql()).toBe('');
      });

      it('asking for work proves the worker is idle: what it still held is failed at once, and it shows as alive', async () => {
        workerRepository.findOneBy.mockResolvedValue(managed());

        await service.claim(7, undefined, 5);

        expect(workerRepository.update).toHaveBeenCalledWith(5, {
          lastSeenAt: expect.any(Date) as Date,
        });
        const sweep = (repository.query as jest.Mock).mock.calls.find(
          (call: unknown[]) => (call[0] as string).includes('"workerId" ='),
        ) as [string, unknown[]] | undefined;

        expect(sweep?.[0]).toContain('SET status');
        expect(sweep?.[1]).toContain(5);
      });
    });

    describe('create', () => {
      beforeEach(() => {
        storageService.findOwned!.mockResolvedValue({
          id: 1,
          originalName: '402-6.subscription.zip',
        });
        repository.save!.mockImplementation((job) =>
          Promise.resolve({ id: 10, ...job }),
        );
      });

      it('pins a job to a worker that is the owner’s, switched on and able to run the model', async () => {
        workerRepository.findOneBy.mockResolvedValue(managed());

        const job = await service.create(7, {
          sourceFileId: 1,
          model: JobModel.Sonnet,
          targetWorkerId: 5,
        });

        expect(workerRepository.findOneBy).toHaveBeenCalledWith({
          id: 5,
          userId: 7,
        });
        expect(job).toMatchObject({ targetWorkerId: 5 });
      });

      it('refuses a worker that does not exist or belongs to someone else', async () => {
        workerRepository.findOneBy.mockResolvedValue(null);

        await expect(
          service.create(7, {
            sourceFileId: 1,
            model: JobModel.Sonnet,
            targetWorkerId: 5,
          }),
        ).rejects.toThrow('Worker not found');
        expect(repository.save).not.toHaveBeenCalled();
      });

      it('refuses a paused worker — the job would wait for ever', async () => {
        workerRepository.findOneBy.mockResolvedValue(
          managed({ enabled: false }),
        );

        await expect(
          service.create(7, {
            sourceFileId: 1,
            model: JobModel.Sonnet,
            targetWorkerId: 5,
          }),
        ).rejects.toThrow('is paused');
      });

      it('refuses a worker that is not set up for the model', async () => {
        workerRepository.findOneBy.mockResolvedValue(
          managed({ models: [JobModel.Gpt] }),
        );

        await expect(
          service.create(7, {
            sourceFileId: 1,
            model: JobModel.Opus,
            targetWorkerId: 5,
          }),
        ).rejects.toThrow('not set up to run opus');
      });

      it('without a pin the job is for any free worker', async () => {
        const job = await service.create(7, {
          sourceFileId: 1,
          model: JobModel.Sonnet,
        });

        expect(workerRepository.findOneBy).not.toHaveBeenCalled();
        expect(job).toMatchObject({ targetWorkerId: null });
      });

      it('accepts a stored API key of the right provider and refuses one that is not', async () => {
        providerCredentials.existsFor.mockResolvedValueOnce(true);
        await expect(
          service.create(7, {
            sourceFileId: 1,
            model: JobModel.Gpt,
            providerCredentialId: 3,
          }),
        ).resolves.toMatchObject({ providerCredentialId: 3 });

        providerCredentials.existsFor.mockResolvedValueOnce(false);
        await expect(
          service.create(7, {
            sourceFileId: 1,
            model: JobModel.Gpt,
            providerCredentialId: 4,
          }),
        ).rejects.toThrow('Provider credential not found');
      });

      it('refuses a provider key for a Claude model', async () => {
        await expect(
          service.create(7, {
            sourceFileId: 1,
            model: JobModel.Sonnet,
            providerCredentialId: 3,
          }),
        ).rejects.toThrow('Provider credential not found');
      });
    });

    describe('findHeld', () => {
      it('returns the job for a personal API key', async () => {
        repository.findOne!.mockResolvedValue({
          id: 1,
          userId: 7,
          workerId: 5,
        });

        await expect(service.findHeld(1, 7, undefined)).resolves.toMatchObject({
          id: 1,
        });
        expect(repository.findOne).toHaveBeenCalledTimes(1);
      });

      it('returns the job for the worker holding it', async () => {
        repository.findOne!.mockResolvedValue({
          id: 1,
          userId: 7,
          workerId: 5,
        });

        await expect(service.findHeld(1, 7, 5)).resolves.toMatchObject({
          id: 1,
        });
      });

      it('403s for a job held by another worker', async () => {
        repository.findOne!.mockResolvedValue({
          id: 1,
          userId: 7,
          workerId: 5,
        });

        await expect(service.findHeld(1, 7, 6)).rejects.toThrow(
          'not held by this worker',
        );
      });

      it('404s for an unknown or foreign job', async () => {
        repository.findOne!.mockResolvedValue(null);

        await expect(service.findHeld(1, 7, 5)).rejects.toThrow(
          NotFoundException,
        );
      });
    });

    describe('assertHeldBy', () => {
      it('lets a personal API key through (account-wide reach)', async () => {
        await expect(
          service.assertHeldBy(1, 7, undefined),
        ).resolves.toBeUndefined();
        expect(repository.findOne).not.toHaveBeenCalled();
      });

      it('lets a worker touch the job it holds, and nobody else’s', async () => {
        repository.findOne!.mockResolvedValue({
          id: 1,
          userId: 7,
          workerId: 5,
        });
        await expect(service.assertHeldBy(1, 7, 5)).resolves.toBeUndefined();

        await expect(service.assertHeldBy(1, 7, 6)).rejects.toThrow(
          'not held by this worker',
        );
      });
    });
  });

  describe('retry with another model or token', () => {
    const failed = (over = {}) => ({
      id: 5,
      userId: 7,
      sourceFileId: 11,
      model: JobModel.Sonnet,
      claudeCredentialId: 2,
      providerCredentialId: null,
      status: JobStatus.Failed,
      errorMessage: 'boom',
      ...over,
    });

    beforeEach(() => {
      storageService.findOwned!.mockResolvedValue({
        id: 11,
        originalName: 'x.zip',
      });
      claudeCredentialsService.resolveToken!.mockResolvedValue('token');
      repository.save!.mockImplementation((job) =>
        Promise.resolve({ id: 6, ...job }),
      );
    });

    it('runs on the chosen model and Claude credential', async () => {
      repository.findOne!.mockResolvedValue(failed());

      const retried = await service.retry(5, 7, undefined, {
        model: JobModel.Opus,
        claudeCredentialId: 3,
      });

      expect(retried).toMatchObject({
        model: JobModel.Opus,
        claudeCredentialId: 3,
        status: JobStatus.Queued,
      });
      expect(appLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({
            newModel: JobModel.Opus,
            claudeCredentialId: 3,
          }),
        }),
      );
    });

    it('drops the Claude credential when switching to a provider model', async () => {
      repository.findOne!.mockResolvedValue(failed());

      const retried = await service.retry(5, 7, undefined, {
        model: JobModel.Deepseek,
      });

      expect(retried).toMatchObject({
        model: JobModel.Deepseek,
        claudeCredentialId: null,
        providerCredentialId: null,
      });
    });

    it('rejects a provider credential that does not fit the model', async () => {
      repository.findOne!.mockResolvedValue(failed());
      providerCredentials.existsFor.mockResolvedValueOnce(false);

      await expect(
        service.retry(5, 7, undefined, {
          model: JobModel.Deepseek,
          providerCredentialId: 4,
        }),
      ).rejects.toThrow('Provider credential not found for this model');
    });

    it('releases the pin when the worker does not allow the new model', async () => {
      repository.findOne!.mockResolvedValue(failed({ targetWorkerId: 9 }));
      workerRepository.findOneBy!.mockResolvedValue({
        id: 9,
        enabled: true,
        models: ['sonnet'],
      });

      const retried = await service.retry(5, 7, undefined, {
        model: JobModel.Opus,
      });

      expect(retried.targetWorkerId).toBeNull();
    });
  });
});
