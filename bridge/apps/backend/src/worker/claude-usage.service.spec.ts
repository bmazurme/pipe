import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';

import { ClaudeCredentialsService } from './claude-credentials.service';
import { ClaudeUsageService } from './claude-usage.service';
import { Job } from './entities/job.entity';
import { Worker } from './entities/worker.entity';

describe('ClaudeUsageService', () => {
  let service: ClaudeUsageService;
  let repository: { findOne: jest.Mock; update: jest.Mock };
  let workerRepository: { findOneBy: jest.Mock; update: jest.Mock };
  let claudeCredentialsService: {
    recordLimits: jest.Mock;
    clearAuthFailed: jest.Mock;
    resolveForRun: jest.Mock;
    nameOf: jest.Mock;
  };

  beforeEach(async () => {
    repository = { findOne: jest.fn(), update: jest.fn() };
    workerRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    };
    claudeCredentialsService = {
      recordLimits: jest.fn(),
      clearAuthFailed: jest.fn(),
      resolveForRun: jest.fn(),
      nameOf: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaudeUsageService,
        { provide: getRepositoryToken(Job), useValue: repository },
        { provide: getRepositoryToken(Worker), useValue: workerRepository },
        {
          provide: ClaudeCredentialsService,
          useValue: claudeCredentialsService,
        },
      ],
    }).compile();

    service = module.get(ClaudeUsageService);
  });

  describe('recordReport', () => {
    const limits = {
      status: 'allowed_warning',
      rateLimitType: 'seven_day',
      isUsingOverage: false,
      windows: { seven_day: { utilization: 0.76, resetsAt: 1792148400 } },
    };
    const usage = {
      costUsd: 0.25,
      inputTokens: 2,
      outputTokens: 4,
      cacheReadTokens: 10,
      cacheCreationTokens: 7,
    };
    const now = new Date('2026-10-14T12:00:00.000Z');

    it('clears the rejected mark of the token a reporting job ran on', async () => {
      repository.findOne!.mockResolvedValue({
        id: 7,
        userId: 3,
        workerId: 5,
        claudeCredentialId: 11,
      });

      await service.recordReport(3, 5, { jobId: 7, usage }, now);

      expect(claudeCredentialsService.clearAuthFailed).toHaveBeenCalledWith(
        11,
        3,
      );
    });

    it('keeps the limits on the worker, and the job usage and the token limits on the job it ran', async () => {
      repository.findOne!.mockResolvedValue({
        id: 7,
        userId: 3,
        workerId: 5,
        claudeCredentialId: 11,
      });

      await service.recordReport(3, 5, { jobId: 7, limits, usage }, now);

      expect(workerRepository.update).toHaveBeenCalledWith(
        { id: 5, userId: 3 },
        {
          claudeLimits: { ...limits, reportedAt: '2026-10-14T12:00:00.000Z' },
        },
      );
      expect(repository.update).toHaveBeenCalledWith(7, { usage });
      expect(claudeCredentialsService.recordLimits).toHaveBeenCalledWith(
        11,
        3,
        expect.objectContaining({ status: 'allowed_warning' }),
      );
    });

    it('does not put the limits of a token the job picked on a worker that uses another token', async () => {
      repository.findOne!.mockResolvedValue({
        id: 7,
        userId: 3,
        workerId: 5,
        claudeCredentialId: 11,
      });
      workerRepository.findOneBy.mockResolvedValue({
        id: 5,
        claudeCredentialId: 12,
      });
      claudeCredentialsService.resolveForRun.mockResolvedValue({
        id: 12,
        token: 't',
      });

      await service.recordReport(3, 5, { jobId: 7, limits, usage }, now);

      expect(workerRepository.update).not.toHaveBeenCalled();
      // They are still the limits of the token the job ran on.
      expect(claudeCredentialsService.recordLimits).toHaveBeenCalledWith(
        11,
        3,
        expect.objectContaining({ status: 'allowed_warning' }),
      );
    });

    it('keeps the limits on the worker when the job ran on the token the worker uses', async () => {
      repository.findOne!.mockResolvedValue({
        id: 7,
        userId: 3,
        workerId: 5,
        claudeCredentialId: null,
        usedClaudeCredentialId: 12,
      });
      workerRepository.findOneBy.mockResolvedValue({
        id: 5,
        claudeCredentialId: null,
      });
      claudeCredentialsService.resolveForRun.mockResolvedValue({
        id: 12,
        token: 't',
      });

      await service.recordReport(3, 5, { jobId: 7, limits, usage }, now);

      expect(workerRepository.update).toHaveBeenCalledWith(
        { id: 5, userId: 3 },
        {
          claudeLimits: expect.objectContaining({ status: 'allowed_warning' }),
        },
      );
    });

    it('records the limits on the fallback token the job ran on', async () => {
      repository.findOne!.mockResolvedValue({
        id: 7,
        userId: 3,
        workerId: 5,
        claudeCredentialId: null,
        usedClaudeCredentialId: 12,
      });

      await service.recordReport(3, 5, { jobId: 7, limits, usage }, now);

      expect(claudeCredentialsService.recordLimits).toHaveBeenCalledWith(
        12,
        3,
        expect.objectContaining({ status: 'allowed_warning' }),
      );
    });

    it('for a chat turn (no job) only updates the worker', async () => {
      await service.recordReport(3, 5, { limits }, now);

      expect(workerRepository.update).toHaveBeenCalledTimes(1);
      expect(repository.findOne).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('does not touch a token when the job ran on the worker own login', async () => {
      repository.findOne!.mockResolvedValue({
        id: 7,
        userId: 3,
        workerId: 5,
        claudeCredentialId: null,
      });

      await service.recordReport(3, 5, { jobId: 7, limits, usage }, now);

      expect(claudeCredentialsService.recordLimits).not.toHaveBeenCalled();
    });

    it('refuses a job another worker holds', async () => {
      repository.findOne!.mockResolvedValue({ id: 7, userId: 3, workerId: 6 });

      await expect(
        service.recordReport(3, 5, { jobId: 7, usage }, now),
      ).rejects.toThrow(/not held by this worker/);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('drops garbage instead of storing it', async () => {
      await service.recordReport(
        3,
        5,
        { limits: { nope: true }, usage: undefined },
        now,
      );

      expect(workerRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('recordUsedCredential', () => {
    it('stores the token and its name on the job', async () => {
      claudeCredentialsService.nameOf.mockResolvedValue('main');

      await service.recordUsedCredential(7, 3, 11);

      expect(claudeCredentialsService.nameOf).toHaveBeenCalledWith(11, 3);
      expect(repository.update).toHaveBeenCalledWith(7, {
        usedClaudeCredentialId: 11,
        usedClaudeCredentialName: 'main',
      });
    });
  });
});
