import { LabRun, LabRunStatus } from './entities/lab-run.entity';
import { LabProject } from './entities/lab-project.entity';
import * as labGithub from './lab-github';
import { LabPublishService } from './lab-publish.service';
import * as labResult from './lab-result';

describe('LabPublishService', () => {
  const project = {
    id: 3,
    userId: 1,
    repo: 'owner/repo',
    token: 'ghp_x',
    baseBranch: 'main',
    canWrite: true,
  } as LabProject;
  let github: Record<string, jest.Mock>;
  let notifier: { send: jest.Mock };
  let service: LabPublishService;

  beforeEach(() => {
    github = {
      getCommitTreeSha: jest.fn().mockResolvedValue('tree-base'),
      createBlob: jest.fn().mockResolvedValue('blob'),
      createTree: jest.fn().mockResolvedValue('tree'),
      createCommit: jest.fn().mockResolvedValue('commit'),
      createBranch: jest.fn().mockResolvedValue(undefined),
      createPull: jest
        .fn()
        .mockResolvedValue({ number: 7, htmlUrl: 'https://pr/7' }),
      deleteBranch: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(labGithub, 'githubFor').mockReturnValue(github as never);
    jest.spyOn(labResult, 'readLabResult').mockResolvedValue({
      files: new Map([
        ['new.txt', new TextEncoder().encode('hello')],
        ['.github/workflows/ci.yml', new TextEncoder().encode('x')],
      ]),
      binaries: new Map(),
    } as never);
    notifier = { send: jest.fn().mockResolvedValue(undefined) };
    service = new LabPublishService(
      {
        findOne: jest.fn().mockResolvedValue({ id: 9, baseline: '{}' }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      } as never,
      { findOwned: jest.fn().mockResolvedValue(project) } as never,
      {
        findOwned: jest.fn().mockResolvedValue({ id: 6 }),
        readBytes: jest.fn().mockResolvedValue(new Uint8Array()),
        delete: jest.fn().mockResolvedValue(undefined),
      } as never,
      notifier as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const run = (baseBranch: string | null) =>
    ({
      id: 9,
      userId: 1,
      projectId: project.id,
      repo: project.repo,
      title: 'Fix',
      task: 'Fix the test',
      model: 'sonnet',
      trigger: 'manual',
      status: LabRunStatus.Publishing,
      baseSha: 'sha-base',
      baseBranch,
    }) as LabRun;

  it('opens the pull request against the branch of the run', async () => {
    await service.publish(run('release/1.4'), 6);

    expect(github.createPull).toHaveBeenCalledWith(
      expect.objectContaining({ base: 'release/1.4' }),
    );
  });

  it("opens a run from before the per-run branch against the project's", async () => {
    await service.publish(run(null), 6);

    expect(github.createPull).toHaveBeenCalledWith(
      expect.objectContaining({ base: 'main' }),
    );
  });

  it('drops changes under .github/workflows from the tree', async () => {
    const published = run('main');

    await service.publish(published, 6);

    expect(github.createBlob).toHaveBeenCalledTimes(1);
    expect(published.status).toBe(LabRunStatus.PrOpen);
  });

  it('fails the run and removes the branch when the pull request cannot be opened', async () => {
    github.createPull.mockRejectedValue(new Error('nope'));

    const failed = run('main');

    await service.publish(failed, 6);

    expect(github.deleteBranch).toHaveBeenCalled();
    expect(failed.status).toBe(LabRunStatus.Failed);
  });
});
