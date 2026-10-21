import { BadRequestException, NotFoundException } from '@nestjs/common';

import {
  ACTIVE_LAB_RUN_STATUSES,
  LabRunStatus,
} from './entities/lab-run.entity';
import * as labGithub from './lab-github';
import { downloadRepoZip, githubFor, isValidRepo } from './lab-github';
import { LabRunsService, isBlocked, titleOf } from './lab-runs.service';
import { LabProjectsService, toView } from './lab-projects.service';
import { LabProject } from './entities/lab-project.entity';
import { LabRun } from './entities/lab-run.entity';
import { readLabResult } from './lab-result';
import { buildIssueParcel, readZipball } from '../improve/parcel';

jest.mock('./lab-github', () => ({
  ...jest.requireActual<object>('./lab-github'),
  githubFor: jest.fn(),
  downloadRepoZip: jest.fn(),
}));
jest.mock('./lab-result', () => ({
  ...jest.requireActual<object>('./lab-result'),
  readLabResult: jest.fn(),
}));
jest.mock('../improve/parcel', () => {
  const actual =
    jest.requireActual<typeof import('../improve/parcel')>('../improve/parcel');

  return {
    ...actual,
    readZipball: jest.fn(),
    buildIssueParcel: jest.fn(actual.buildIssueParcel),
  };
});

describe('Lab helpers', () => {
  it('takes the first line of a task as its title and cuts a long one', () => {
    expect(titleOf('  Обновить README\nи тесты')).toBe('Обновить README');
    expect(titleOf('x'.repeat(200))).toHaveLength(80);
  });

  it('never lets a run change CI definitions or git internals', () => {
    expect(isBlocked('.github/workflows/ci.yml')).toBe(true);
    expect(isBlocked('.git/config')).toBe(true);
    expect(isBlocked('src/.github/workflows/x.yml')).toBe(false);
    expect(isBlocked('README.md')).toBe(false);
  });

  it('accepts owner/name only', () => {
    expect(isValidRepo('bmazurme/pipe')).toBe(true);
    expect(isValidRepo('pipe')).toBe(false);
    expect(isValidRepo('a/b/c')).toBe(false);
    expect(isValidRepo('a/..')).toBe(false);
  });

  it('never exposes the token of a project', () => {
    const view = toView({
      id: 1,
      name: 'p',
      token: 'ghp_secret',
      tokenHint: 'cret',
    } as LabProject);

    expect(view).not.toHaveProperty('token');
    expect(view.tokenHint).toBe('cret');
  });
});

describe('LabRunsService repo snapshot cache', () => {
  const downloadRepoZip = jest.fn();
  const getBranchSha = jest.fn();

  const load = () => {
    jest.resetModules();
    jest.doMock('./lab-github', () => ({
      ...jest.requireActual('./lab-github'),
      downloadRepoZip: (...args: unknown[]) => downloadRepoZip(...args),
      githubFor: () => ({ getBranchSha }),
    }));
    jest.doMock('./lab-result', () => ({
      ...jest.requireActual('./lab-result'),
      selectLabSnapshot: () => ({
        files: [],
        binaries: [],
        skipped: [],
        baseline: {},
      }),
    }));
    jest.doMock('../improve/parcel', () => ({
      ...jest.requireActual('../improve/parcel'),
      readZipball: async () => [],
      buildIssueParcel: async () => ({ buffer: Buffer.from('x') }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LabRunsService } = require('./lab-runs.service');
    const project = {
      id: 1,
      repo: 'o/r',
      token: 't',
      baseBranch: 'main',
      canWrite: true,
      updatedAt: new Date(1000),
    };
    const projects = { findOwned: jest.fn(async () => project) };
    const runs = {
      count: jest.fn(async () => 0),
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown) => x),
    };
    const service = new LabRunsService(
      runs,
      projects,
      { create: jest.fn(async () => ({ id: 7 })) },
      { createFromBuffer: jest.fn(async () => ({ id: 3 })) },
      { findOwned: jest.fn() },
      {},
    );
    const start = async (task: string) =>
      (await service.launch(1, { projectId: 1, task, model: 'sonnet' }))
        .prepared;

    return { service, project, start };
  };

  beforeEach(() => {
    downloadRepoZip.mockReset().mockResolvedValue(new Uint8Array());
    getBranchSha.mockReset().mockResolvedValue('sha1');
  });

  it('downloads once for two runs on the same SHA', async () => {
    const { start } = load();

    await start('one');
    await start('two');

    expect(downloadRepoZip).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight download between concurrent starts', async () => {
    const { start } = load();

    await Promise.all([start('one'), start('two')]);

    expect(downloadRepoZip).toHaveBeenCalledTimes(1);
  });

  it('downloads again for a new SHA or an updated project', async () => {
    const { start, project } = load();

    await start('one');
    getBranchSha.mockResolvedValue('sha2');
    await start('two');
    expect(downloadRepoZip).toHaveBeenCalledTimes(2);

    project.updatedAt = new Date(2000);
    await start('three');
    expect(downloadRepoZip).toHaveBeenCalledTimes(3);
  });

  it('does not cache a failed download', async () => {
    const { start } = load();

    downloadRepoZip.mockRejectedValueOnce(new Error('boom'));
    await expect(start('one')).rejects.toThrow();
    await start('one');

    expect(downloadRepoZip).toHaveBeenCalledTimes(2);
  });
});

describe('LabRunsService preparing run', () => {
  const project = {
    id: 7,
    repo: 'o/r',
    token: 't',
    baseBranch: 'main',
    canWrite: true,
  };

  function build(download: () => Promise<unknown>) {
    const rows: Array<Record<string, unknown>> = [];
    const runs = {
      count: jest.fn(
        async ({ where }: { where: { task: string } }) =>
          rows.filter(
            (row) =>
              row.task === where.task &&
              ACTIVE_LAB_RUN_STATUSES.includes(row.status as LabRunStatus),
          ).length,
      ),
      create: jest.fn((row: Record<string, unknown>) => ({ ...row })),
      save: jest.fn(async (row: Record<string, unknown>) => {
        if (!rows.includes(row)) rows.push(row);

        return row;
      }),
      update: jest.fn(
        async (_where: unknown, patch: Record<string, unknown>) => {
          Object.assign(rows[0], patch);
        },
      ),
    };
    const service = new LabRunsService(
      runs as never,
      { findOwned: jest.fn(async () => project) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    jest.spyOn(labGithub, 'githubFor').mockReturnValue({
      getBranchSha: async () => 'sha',
    } as never);
    jest
      .spyOn(labGithub, 'downloadRepoZip')
      .mockImplementation(download as never);

    return { service, rows, runs };
  }

  const input = { projectId: 7, task: 'do it', model: 'sonnet' };

  afterEach(() => jest.restoreAllMocks());

  it('rejects a second start of the same task while the download is pending', async () => {
    const { service, rows } = build(() => new Promise(() => undefined));

    void service.start(1, input);
    await new Promise((resolve) => setImmediate(resolve));

    expect(rows[0].status).toBe(LabRunStatus.Preparing);
    await expect(service.start(1, input)).rejects.toThrow(
      'Эта задача в этом проекте уже выполняется',
    );
  });

  it('marks the run failed with the step message when the download fails', async () => {
    const { service, rows } = build(async () => {
      throw new Error('boom');
    });

    const { prepared } = await service.launch(1, input);

    await expect(prepared).rejects.toThrow();
    expect(rows[0].status).toBe(LabRunStatus.Failed);
    expect(String(rows[0].error)).toContain('скачивание репозитория');
  });

  it('answers with the preparing run without waiting for the download', async () => {
    const { service } = build(() => new Promise(() => undefined));

    const run = await service.start(1, input);

    expect(run.status).toBe(LabRunStatus.Preparing);
  });

  it('answers a failing download with the preparing run and only logs it', async () => {
    const { service, rows } = build(async () => {
      throw new Error('boom');
    });

    await expect(service.start(1, input)).resolves.toMatchObject({
      task: 'do it',
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(rows[0].status).toBe(LabRunStatus.Failed);
  });

  it('rejects an unknown project or a read-only token right away', async () => {
    const { service } = build(() => new Promise(() => undefined));
    const projects = (
      service as unknown as { projects: { findOwned: jest.Mock } }
    ).projects;

    projects.findOwned.mockRejectedValueOnce(new NotFoundException());
    await expect(service.start(1, input)).rejects.toThrow(NotFoundException);

    projects.findOwned.mockResolvedValueOnce({ ...project, canWrite: false });
    await expect(service.start(1, input)).rejects.toThrow(BadRequestException);
  });

  it('fails only stale preparing rows in advance()', async () => {
    const execute = jest.fn(async () => undefined);
    const where = jest.fn(() => ({ execute }));
    const qb = {
      update: () => qb,
      set: () => qb,
      where,
    };
    const service = new LabRunsService(
      {
        createQueryBuilder: () => qb,
        find: jest.fn(async () => []),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.advance();

    const calls = where.mock.calls as unknown as Array<
      [string, { status: string; before: Date }]
    >;
    const preparing = calls.find(
      ([, p]) => p.status === LabRunStatus.Preparing,
    );

    expect(preparing).toBeDefined();
    expect(preparing![1].before.getTime()).toBeLessThan(
      Date.now() - 10 * 60_000,
    );
  });
});

describe('LabRunsService: the branch of a run', () => {
  const project = {
    id: 3,
    userId: 1,
    repo: 'owner/repo',
    token: 'ghp_x',
    baseBranch: 'main',
    canWrite: true,
  } as LabProject;
  let github: {
    getBranchSha: jest.Mock;
    getCommitTreeSha: jest.Mock;
    createBlob: jest.Mock;
    createTree: jest.Mock;
    createCommit: jest.Mock;
    createBranch: jest.Mock;
    createPull: jest.Mock;
    deleteBranch: jest.Mock;
  };
  let runs: {
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let workers: { create: jest.Mock; hasEnabledWorkerWith: jest.Mock };
  let service: LabRunsService;

  beforeEach(() => {
    jest.clearAllMocks();
    github = {
      getBranchSha: jest.fn().mockResolvedValue('sha-base'),
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
    (githubFor as jest.Mock).mockReturnValue(github);
    (downloadRepoZip as jest.Mock).mockResolvedValue(new Uint8Array());
    (readZipball as jest.Mock).mockResolvedValue([]);
    (readLabResult as jest.Mock).mockResolvedValue({
      files: new Map([['new.txt', new TextEncoder().encode('hello')]]),
      binaries: new Map(),
    });
    runs = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((row: Partial<LabRun>) => row),
      save: jest.fn((row: Partial<LabRun>) =>
        Promise.resolve({ id: 9, ...row }),
      ),
      findOne: jest.fn().mockResolvedValue({ id: 9, baseline: '{}' }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    workers = {
      create: jest.fn().mockResolvedValue({ id: 42 }),
      hasEnabledWorkerWith: jest.fn().mockResolvedValue(true),
    };
    service = new LabRunsService(
      runs as never,
      {
        findOwned: jest.fn().mockResolvedValue(project),
      } as unknown as LabProjectsService,
      workers as never,
      {
        createFromBuffer: jest.fn().mockResolvedValue({ id: 5 }),
        findOwned: jest.fn().mockResolvedValue({ id: 6 }),
        readBytes: jest.fn().mockResolvedValue(new Uint8Array()),
        delete: jest.fn().mockResolvedValue(undefined),
      } as never,
      { findOwned: jest.fn() } as never,
      { send: jest.fn().mockResolvedValue(undefined) } as never,
    );
  });

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

  const prepare = async (input: Parameters<LabRunsService['launch']>[1]) =>
    (await service.launch(1, input)).prepared;

  it('snapshots and stores an explicitly chosen branch', async () => {
    const saved = await prepare({
      projectId: project.id,
      task: 'Fix the test',
      model: 'sonnet',
      baseBranch: 'release/1.4',
    });

    expect(github.getBranchSha).toHaveBeenCalledWith('release/1.4');
    expect((buildIssueParcel as jest.Mock).mock.calls[0][1]).toMatchObject({
      baseBranch: 'release/1.4',
    });
    expect(saved).toMatchObject({
      baseBranch: 'release/1.4',
      baseSha: 'sha-base',
      jobId: 42,
    });
  });

  it("uses the project's branch when none is chosen", async () => {
    const saved = await prepare({
      projectId: project.id,
      task: 'Fix the test',
      model: 'sonnet',
    });

    expect(github.getBranchSha).toHaveBeenCalledWith('main');
    expect(saved.baseBranch).toBe('main');
  });

  it('creates no job when the chosen branch does not exist', async () => {
    github.getBranchSha.mockRejectedValue(new Error('Ветка «nope» не найдена'));

    await expect(
      prepare({
        projectId: project.id,
        task: 'Fix the test',
        model: 'sonnet',
        baseBranch: 'nope',
      }),
    ).rejects.toThrow('не найдена');
    expect(workers.create).not.toHaveBeenCalled();
  });

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

  it('hands a Fusion run to the job as a required capability, and records where it runs', async () => {
    const saved = await prepare({
      projectId: project.id,
      task: 'Построить корпус',
      model: 'sonnet',
      executor: 'fusion',
    });

    expect(workers.hasEnabledWorkerWith).toHaveBeenCalledWith(1, 'fusion');
    expect(workers.create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ requiredCapability: 'fusion' }),
    );
    expect(saved.executor).toBe('fusion');
  });

  it('refuses a Fusion run when no worker with Fusion is switched on', async () => {
    workers.hasEnabledWorkerWith.mockResolvedValue(false);

    await expect(
      service.launch(1, {
        projectId: project.id,
        task: 'Построить корпус',
        model: 'sonnet',
        executor: 'fusion',
      }),
    ).rejects.toThrow(/Нет включённого worker с Fusion 360/);
    expect(runs.save).not.toHaveBeenCalled();
  });

  it('puts an ordinary run on any worker, with no capability required', async () => {
    const saved = await prepare({
      projectId: project.id,
      task: 'Fix the test',
      model: 'sonnet',
    });

    expect(workers.hasEnabledWorkerWith).not.toHaveBeenCalled();
    expect(workers.create.mock.calls[0][1]).not.toHaveProperty(
      'requiredCapability',
    );
    expect(saved.executor).toBe('any');
  });
});
