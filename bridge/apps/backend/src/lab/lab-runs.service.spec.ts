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
