import {
  ACTIVE_LAB_RUN_STATUSES,
  LabRunStatus,
} from './entities/lab-run.entity';
import * as labGithub from './lab-github';
import { LabRunsService } from './lab-runs.service';
import { isBlocked, titleOf } from './lab-runs.service';
import { isValidRepo } from './lab-github';
import { toView } from './lab-projects.service';
import { LabProject } from './entities/lab-project.entity';

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
    const start = (task: string) =>
      service.start(1, { projectId: 1, task, model: 'sonnet' });

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

    await expect(service.start(1, input)).rejects.toThrow();
    expect(rows[0].status).toBe(LabRunStatus.Failed);
    expect(String(rows[0].error)).toContain('скачивание репозитория');
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
