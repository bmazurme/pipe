import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { StorageService } from '../storage/storage.service';
import { Job, JobModel, JobStatus } from './entities/job.entity';
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

  beforeEach(async () => {
    repository = createMockRepository();
    storageService = {
      findOwned: jest.fn(),
      create: jest.fn(),
      path: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerService,
        { provide: getRepositoryToken(Job), useValue: repository },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();

    service = module.get(WorkerService);
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
        status: JobStatus.Queued,
      });
      expect(job).toMatchObject({ id: 10, status: JobStatus.Queued });
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

  describe('claim', () => {
    it('returns null when nothing is queued', async () => {
      repository.query!.mockResolvedValue([]);
      await expect(service.claim(7)).resolves.toBeNull();
      expect(repository.findOneBy).not.toHaveBeenCalled();
    });

    it('claims the oldest queued job atomically via SKIP LOCKED', async () => {
      repository.query!.mockResolvedValue([{ id: 42 }]);
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
        resultFileId: null,
        status: JobStatus.Running,
      } as Job;
      repository.findOne!.mockResolvedValue(job);
      storageService.create!.mockResolvedValue({ id: 99 });
      repository.save!.mockImplementation((j) => Promise.resolve(j));

      const file = { originalname: 'result.zip' } as Express.Multer.File;
      const result = await service.setResult(1, 7, file);

      expect(storageService.create).toHaveBeenCalledWith(7, file);
      expect(result.resultFileId).toBe(99);
      expect(result.status).toBe(JobStatus.Succeeded);
      expect(result.finishedAt).toBeInstanceOf(Date);
    });
  });
});
