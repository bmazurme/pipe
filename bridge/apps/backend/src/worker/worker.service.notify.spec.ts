import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';

import { ContextUsageRegistry } from '../context/context-usage';
import { ContextService } from '../context/context.service';
import { StorageService } from '../storage/storage.service';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { Job, JobModel, JobStatus } from './entities/job.entity';
import { Worker } from './entities/worker.entity';
import { JobFinishNotifier } from './job-finish-notifier';
import { JobSweepService } from './job-sweep.service';
import { ProviderCredentialsService } from './provider-credentials.service';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerService } from './worker.service';

describe('WorkerService finish notification', () => {
  let service: WorkerService;
  let repository: { findOne: jest.Mock; save: jest.Mock };
  let notifier: { notify: jest.Mock };
  let storage: { findOwned: jest.Mock; create: jest.Mock };

  const job = (extra: Partial<Job> = {}) =>
    ({
      id: 7,
      userId: 1,
      model: JobModel.Sonnet,
      status: JobStatus.Running,
      sourceFileId: null,
      usedClaudeCredentialId: null,
      errorMessage: null,
      failureKind: null,
      notifyOnFinish: true,
      ...extra,
    }) as Job;

  beforeEach(async () => {
    repository = {
      findOne: jest.fn(),
      save: jest.fn((j: Job) => Promise.resolve(j)),
    };
    notifier = { notify: jest.fn().mockResolvedValue(undefined) };
    storage = {
      findOwned: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 99 }),
    };

    const module = await Test.createTestingModule({
      providers: [
        WorkerService,
        { provide: getRepositoryToken(Job), useValue: repository },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: StorageService, useValue: storage },
        { provide: ClaudeCredentialsService, useValue: {} },
        { provide: WorkerHeartbeatService, useValue: {} },
        { provide: ContextService, useValue: {} },
        { provide: ContextUsageRegistry, useValue: { register: jest.fn() } },
        { provide: ProviderCredentialsService, useValue: {} },
        { provide: JobSweepService, useValue: {} },
        { provide: JobFinishNotifier, useValue: notifier },
      ],
    }).compile();

    service = module.get(WorkerService);
  });

  const file = {} as Express.Multer.File;

  it('calls the notifier once after setResult', async () => {
    repository.findOne.mockResolvedValue(job());

    await service.setResult(7, 1, file);

    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, status: JobStatus.Succeeded }),
    );
  });

  it('calls the notifier for a failure that is not re-queued', async () => {
    repository.findOne.mockResolvedValue(job());

    await service.updateStatus(7, 1, {
      status: JobStatus.Failed,
      errorMessage: 'boom',
    } as never);

    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, status: JobStatus.Failed }),
    );
  });

  it('does not call the notifier when the failed job is re-queued automatically', async () => {
    repository.findOne.mockResolvedValue(job());
    jest.spyOn(service, 'retryAfterInfraFailure').mockResolvedValue(job());

    await service.updateStatus(7, 1, {
      status: JobStatus.Failed,
      errorMessage: 'lost',
    } as never);

    expect(notifier.notify).not.toHaveBeenCalled();
  });
});
