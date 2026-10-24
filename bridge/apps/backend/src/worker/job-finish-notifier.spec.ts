import { Test } from '@nestjs/testing';

import { DeploymentAccessService } from '../auth/deployment-access';
import { NotifyService } from '../telegram/notify.service';
import { Job, JobModel, JobStatus } from './entities/job.entity';
import { JobFinishNotifier } from './job-finish-notifier';

describe('JobFinishNotifier', () => {
  let notifier: JobFinishNotifier;
  let notify: { send: jest.Mock };
  let access: { isOwner: jest.Mock };

  const job = (extra: Partial<Job> = {}) =>
    ({
      id: 7,
      userId: 1,
      model: JobModel.Sonnet,
      status: JobStatus.Succeeded,
      errorMessage: null,
      notifyOnFinish: true,
      ...extra,
    }) as Job;

  beforeEach(async () => {
    notify = { send: jest.fn().mockResolvedValue(true) };
    access = { isOwner: jest.fn().mockResolvedValue(true) };

    const module = await Test.createTestingModule({
      providers: [
        JobFinishNotifier,
        { provide: NotifyService, useValue: notify },
        { provide: DeploymentAccessService, useValue: access },
      ],
    }).compile();

    notifier = module.get(JobFinishNotifier);
  });

  it('notifies once on success when flagged', async () => {
    await notifier.notify(job());

    expect(notify.send).toHaveBeenCalledTimes(1);
    expect(notify.send).toHaveBeenCalledWith(
      `✅ Задача #7 (${JobModel.Sonnet}) завершена`,
    );
  });

  it('notifies on failure with a trimmed error', async () => {
    await notifier.notify(
      job({ status: JobStatus.Failed, errorMessage: 'x'.repeat(500) }),
    );

    expect(notify.send).toHaveBeenCalledTimes(1);
    const text = notify.send.mock.calls[0][0] as string;
    expect(text).toContain('🔴 Задача #7');
    expect(text.endsWith('x'.repeat(200))).toBe(true);
    expect(text).not.toContain('x'.repeat(201));
  });

  it('stays silent when the flag is off', async () => {
    await notifier.notify(job({ notifyOnFinish: false }));

    expect(notify.send).not.toHaveBeenCalled();
  });

  it('stays silent for a non-owner', async () => {
    access.isOwner.mockResolvedValue(false);

    await notifier.notify(job());

    expect(notify.send).not.toHaveBeenCalled();
  });

  it('never throws when Telegram fails', async () => {
    notify.send.mockRejectedValue(new Error('telegram down'));

    await expect(notifier.notify(job())).resolves.toBeUndefined();
  });

  it('does nothing without its optional collaborators', async () => {
    await expect(
      new JobFinishNotifier().notify(job()),
    ).resolves.toBeUndefined();
  });
});
