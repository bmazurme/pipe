import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';

import { AppLogService } from '../logs/app-log.service';
import { Job, JobModel, JobStatus } from './entities/job.entity';
import { JobSweepService } from './job-sweep.service';

describe('JobSweepService', () => {
  let service: JobSweepService;
  let repository: { query: jest.Mock };
  let appLogs: { record: jest.Mock };

  const stale = (over: Partial<Job> = {}) =>
    ({
      id: 45,
      status: JobStatus.Failed,
      model: JobModel.Sonnet,
      workerName: 'gone-worker',
      errorMessage: 'lost',
      startedAt: new Date(Date.now() - 40 * 60_000),
      finishedAt: new Date(),
      ...over,
    }) as Job;

  beforeEach(async () => {
    repository = { query: jest.fn().mockResolvedValue([[], 0]) };
    appLogs = { record: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        JobSweepService,
        { provide: getRepositoryToken(Job), useValue: repository },
        { provide: AppLogService, useValue: appLogs },
      ],
    }).compile();

    service = module.get(JobSweepService);
  });

  describe('sweepLostJobs', () => {
    it('sweeps jobs silent for hours, whichever worker held them', async () => {
      repository.query.mockResolvedValue([[stale()], 1]);

      await service.sweepLostJobs();

      const [sql, params] = repository.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).not.toContain('"workerName" =');
      expect(sql).not.toContain('"userId" =');
      expect(params).toHaveLength(6);
      expect(appLogs.record).toHaveBeenCalledTimes(1);
    });

    it('does not report a job that finished before the update ran', async () => {
      await service.sweepLostJobs();

      expect(repository.query.mock.calls[0][0]).toContain(
        'WHERE status IN ($5, $6)',
      );
      expect(appLogs.record).not.toHaveBeenCalled();
    });

    it('swallows a failing sweep instead of crashing the scheduler', async () => {
      repository.query.mockRejectedValue(new Error('db down'));

      await expect(service.sweepLostJobs()).resolves.toBeUndefined();
    });
  });

  describe('sweepOrphansFor throttle', () => {
    const sweepCalls = () => repository.query.mock.calls.length;

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('sweeps on the first call and skips a second one within 60 s', async () => {
      await service.sweepOrphansFor(7, 'swarm-worker');
      jest.advanceTimersByTime(30_000);
      await service.sweepOrphansFor(7, 'swarm-worker');

      expect(sweepCalls()).toBe(1);
    });

    it('sweeps again after the window', async () => {
      await service.sweepOrphansFor(7, 'swarm-worker');
      jest.advanceTimersByTime(60_000);
      await service.sweepOrphansFor(7, 'swarm-worker');

      expect(sweepCalls()).toBe(2);
    });

    it('sweeps on the first call of a new worker name', async () => {
      await service.sweepOrphansFor(7, 'swarm-worker');
      await service.sweepOrphansFor(7, 'other-worker');

      expect(sweepCalls()).toBe(2);
    });

    it('does not throw when the sweep fails, and retries next time', async () => {
      repository.query.mockRejectedValueOnce(new Error('db hiccup'));

      await expect(
        service.sweepOrphansFor(7, 'swarm-worker'),
      ).resolves.toBeUndefined();
      await service.sweepOrphansFor(7, 'swarm-worker');

      expect(sweepCalls()).toBe(2);
    });
  });
});
