import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';

import { DeploymentAccessService } from '../auth/deployment-access';
import { ContextService } from '../context/context.service';
import { StorageService } from '../storage/storage.service';
import { NotifyService } from '../telegram/notify.service';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { Job, JobModel, JobStatus } from './entities/job.entity';
import { Worker } from './entities/worker.entity';
import { JobSweepService } from './job-sweep.service';
import { ProviderCredentialsService } from './provider-credentials.service';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerService } from './worker.service';

describe('WorkerService finish notification', () => {
  let service: WorkerService;
  let repository: { findOne: jest.Mock; save: jest.Mock };
  let notify: { send: jest.Mock };
  let access: { isOwner: jest.Mock };
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
    notify = { send: jest.fn().mockResolvedValue(true) };
    access = { isOwner: jest.fn().mockResolvedValue(true) };
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
        { provide: ProviderCredentialsService, useValue: {} },
        { provide: JobSweepService, useValue: {} },
        { provide: NotifyService, useValue: notify },
        { provide: DeploymentAccessService, useValue: access },
      ],
    }).compile();

    service = module.get(WorkerService);
  });

  const file = {} as Express.Multer.File;

  it('notifies once on success when flagged', async () => {
    repository.findOne.mockResolvedValue(job());

    await service.setResult(7, 1, file);

    expect(notify.send).toHaveBeenCalledTimes(1);
    expect(notify.send).toHaveBeenCalledWith(
      `✅ Задача #7 (${JobModel.Sonnet}) завершена`,
    );
  });

  it('notifies on failure with a trimmed error', async () => {
    repository.findOne.mockResolvedValue(job());

    await service.updateStatus(7, 1, {
      status: JobStatus.Failed,
      errorMessage: 'x'.repeat(500),
    } as never);

    expect(notify.send).toHaveBeenCalledTimes(1);
    const text = notify.send.mock.calls[0][0] as string;
    expect(text).toContain('🔴 Задача #7');
    expect(text.endsWith('x'.repeat(200))).toBe(true);
    expect(text).not.toContain('x'.repeat(201));
  });

  it('stays silent when the flag is off', async () => {
    repository.findOne.mockResolvedValue(job({ notifyOnFinish: false }));

    await service.setResult(7, 1, file);

    expect(notify.send).not.toHaveBeenCalled();
  });

  it('stays silent for a non-owner', async () => {
    access.isOwner.mockResolvedValue(false);
    repository.findOne.mockResolvedValue(job());

    await service.setResult(7, 1, file);

    expect(notify.send).not.toHaveBeenCalled();
  });

  it('stays silent when the failed job is re-queued automatically', async () => {
    repository.findOne.mockResolvedValue(job());
    jest.spyOn(service, 'retryAfterInfraFailure').mockResolvedValue(job());

    await service.updateStatus(7, 1, {
      status: JobStatus.Failed,
      errorMessage: 'lost',
    } as never);

    expect(notify.send).not.toHaveBeenCalled();
  });

  it('does not fail setResult when Telegram fails', async () => {
    notify.send.mockRejectedValue(new Error('telegram down'));
    repository.findOne.mockResolvedValue(job());

    await expect(service.setResult(7, 1, file)).resolves.toMatchObject({
      status: JobStatus.Succeeded,
    });
  });
});
