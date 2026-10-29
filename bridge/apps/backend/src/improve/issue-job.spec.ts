import { StoredFileDirection } from '../storage/entities/stored-file.entity';
import { JobModel } from '../worker/entities/job.entity';
import { launchIssueJob } from './issue-job';

describe('launchIssueJob', () => {
  const setup = () => {
    const storage = {
      createFromBuffer: jest.fn().mockResolvedValue({ id: 7 }),
    };
    const workers = { create: jest.fn().mockResolvedValue({ id: 9 }) };
    const run = (extra: Record<string, unknown> = {}) =>
      launchIssueJob(
        { storage, workers } as never,
        {
          userId: 3,
          files: [{ path: 'a.txt', bytes: new TextEncoder().encode('hi') }],
          task: {
            number: 1,
            title: 't',
            body: 'b',
            repo: 'o/r',
            baseBranch: 'main',
          },
          baseline: {},
          fileName: 'f.zip',
          taskKey: 'k',
          model: 'sonnet' as JobModel,
          ...extra,
        } as never,
      );

    return { storage, workers, run };
  };

  it('stores an outbound issue file and creates a job without optional fields', async () => {
    const { storage, workers, run } = setup();

    await expect(run()).resolves.toEqual({
      job: { id: 9 },
      storedFileId: 7,
    });
    expect(storage.createFromBuffer).toHaveBeenCalledWith(
      3,
      expect.any(Buffer),
      'f.zip',
      {
        channel: 'issue',
        taskKey: 'k',
        direction: StoredFileDirection.Outbound,
      },
    );
    expect(workers.create).toHaveBeenCalledWith(3, {
      sourceFileId: 7,
      model: 'sonnet',
    });
  });

  it('passes contextId and requiredCapability when set', async () => {
    const { workers, run } = setup();

    await run({ contextId: 5, requiredCapability: 'fusion' });
    expect(workers.create).toHaveBeenCalledWith(3, {
      sourceFileId: 7,
      model: 'sonnet',
      contextId: 5,
      requiredCapability: 'fusion',
    });
  });
});
