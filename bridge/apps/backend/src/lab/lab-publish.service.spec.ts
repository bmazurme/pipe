import { LabRun, LabRunStatus } from './entities/lab-run.entity';
import { LabProject } from './entities/lab-project.entity';
import * as labGithub from './lab-github';
import { extractIssueRequest, LabPublishService } from './lab-publish.service';
import * as labResult from './lab-result';
import { ISSUE_MARKER_PATH } from './lab-result';

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

describe('LabPublishService follow-up of a pull request', () => {
  const project = {
    id: 3,
    userId: 1,
    repo: 'owner/repo',
    token: 'ghp_x',
    baseBranch: 'main',
    canWrite: true,
  } as LabProject;
  let github: Record<string, jest.Mock>;
  let update: jest.Mock;
  let service: LabPublishService;

  beforeEach(() => {
    github = {
      getCommitTreeSha: jest.fn().mockResolvedValue('tree-base'),
      createBlob: jest.fn().mockResolvedValue('blob'),
      createTree: jest.fn().mockResolvedValue('tree'),
      createCommit: jest.fn().mockResolvedValue('commit'),
      updateBranch: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn(),
      createPull: jest.fn(),
    };
    jest.spyOn(labGithub, 'githubFor').mockReturnValue(github as never);
    jest.spyOn(labResult, 'readLabResult').mockResolvedValue({
      files: new Map([['new.txt', new TextEncoder().encode('hello')]]),
      binaries: new Map(),
    } as never);
    update = jest.fn().mockResolvedValue({ affected: 1 });
    service = new LabPublishService(
      {
        findOne: jest.fn().mockResolvedValue({ id: 9, baseline: '{}' }),
        update,
      } as never,
      { findOwned: jest.fn().mockResolvedValue(project) } as never,
      {
        findOwned: jest.fn().mockResolvedValue({ id: 6 }),
        readBytes: jest.fn().mockResolvedValue(new Uint8Array()),
        delete: jest.fn().mockResolvedValue(undefined),
      } as never,
      { send: jest.fn().mockResolvedValue(undefined) } as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const followUp = () =>
    ({
      id: 9,
      userId: 1,
      projectId: project.id,
      repo: project.repo,
      title: 'Fix',
      task: 'Fix more',
      model: 'sonnet',
      trigger: 'manual',
      status: LabRunStatus.Publishing,
      baseSha: 'sha-pr-head',
      baseBranch: 'lab/run-1-fix',
      branch: 'lab/run-1-fix',
      prNumber: 5,
      prUrl: 'https://pr/5',
    }) as LabRun;

  it('adds a commit to the PR branch and opens no new branch or PR', async () => {
    await service.publish(followUp(), 6);

    expect(github.createCommit).toHaveBeenCalledWith(
      expect.stringContaining('Update PR #5'),
      'tree',
      'sha-pr-head',
    );
    expect(github.updateBranch).toHaveBeenCalledWith('lab/run-1-fix', 'commit');
    expect(github.createBranch).not.toHaveBeenCalled();
    expect(github.createPull).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ status: LabRunStatus.PrOpen }),
    );
  });

  it('fails the run when the PR branch has moved', async () => {
    github.updateBranch.mockRejectedValue(
      new Error('Update is not a fast forward'),
    );

    await service.publish(followUp(), 6);

    expect(github.createBranch).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ status: LabRunStatus.Failed }),
    );
  });
});

describe('extractIssueRequest', () => {
  const marker = (body: string, path = ISSUE_MARKER_PATH) => [
    { path, kind: 'modified' as const, bytes: new TextEncoder().encode(body) },
  ];

  it('returns null and leaves changes untouched when there is no marker file', () => {
    const changes = [
      {
        path: 'a.txt',
        kind: 'added' as const,
        bytes: new TextEncoder().encode('x'),
      },
    ];

    expect(extractIssueRequest(changes)).toBeNull();
    expect(changes).toHaveLength(1);
  });

  it('reads the title and body, and removes the marker from the changes', () => {
    const changes = [
      ...marker('{"title":"Проверить лимит","body":"текст"}'),
      {
        path: 'a.txt',
        kind: 'added' as const,
        bytes: new TextEncoder().encode('x'),
      },
    ];

    expect(extractIssueRequest(changes)).toEqual({
      title: 'Проверить лимит',
      body: 'текст',
    });
    expect(changes).toEqual([
      { path: 'a.txt', kind: 'added', bytes: expect.any(Uint8Array) },
    ]);
  });

  it('defaults the body to an empty string when absent', () => {
    expect(extractIssueRequest(marker('{"title":"Заголовок"}'))).toEqual({
      title: 'Заголовок',
      body: '',
    });
  });

  it('throws on invalid JSON', () => {
    expect(() => extractIssueRequest(marker('not json'))).toThrow(
      /невалидный JSON/,
    );
  });

  it('throws when the title is missing or blank', () => {
    expect(() => extractIssueRequest(marker('{"body":"текст"}'))).toThrow(
      /нет заголовка/,
    );
    expect(() => extractIssueRequest(marker('{"title":"  "}'))).toThrow(
      /нет заголовка/,
    );
  });

  it('ignores a deleted marker (nothing to read) but still removes it', () => {
    const changes = [{ path: ISSUE_MARKER_PATH, kind: 'deleted' as const }];

    expect(extractIssueRequest(changes)).toBeNull();
    expect(changes).toHaveLength(0);
  });
});

describe('LabPublishService issue requests', () => {
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
  let update: jest.Mock;
  let service: LabPublishService;

  const setupResult = (files: [string, string][]) => {
    jest.spyOn(labResult, 'readLabResult').mockResolvedValue({
      files: new Map(
        files.map(([path, body]) => [path, new TextEncoder().encode(body)]),
      ),
      binaries: new Map(),
    } as never);
  };

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
      createIssue: jest.fn().mockResolvedValue({
        number: 42,
        htmlUrl: 'https://issue/42',
        missingLabels: [],
      }),
      deleteBranch: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(labGithub, 'githubFor').mockReturnValue(github as never);
    update = jest.fn().mockResolvedValue({ affected: 1 });
    notifier = { send: jest.fn().mockResolvedValue(undefined) };
    service = new LabPublishService(
      {
        findOne: jest.fn().mockResolvedValue({ id: 9, baseline: '{}' }),
        update,
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

  const run = () =>
    ({
      id: 9,
      userId: 1,
      projectId: project.id,
      repo: project.repo,
      title: 'Разобраться с лимитом',
      task: 'Создай Issue: превышаем лимит API',
      model: 'sonnet',
      trigger: 'manual',
      status: LabRunStatus.Publishing,
      baseSha: 'sha-base',
      baseBranch: 'main',
    }) as LabRun;

  it('opens an Issue and no PR when the marker is the only change', async () => {
    setupResult([
      [
        ISSUE_MARKER_PATH,
        '{"title":"Превышаем лимит API","body":"Нужно разобраться"}',
      ],
    ]);
    const published = run();

    await service.publish(published, 6);

    expect(github.createIssue).toHaveBeenCalledWith({
      title: 'Превышаем лимит API',
      body: 'Нужно разобраться',
      labels: [],
    });
    expect(github.createBranch).not.toHaveBeenCalled();
    expect(github.createPull).not.toHaveBeenCalled();
    expect(published.status).toBe(LabRunStatus.IssueOpen);
    expect(published.issueNumber).toBe(42);
    expect(published.issueUrl).toBe('https://issue/42');
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining('Issue #42'),
    );
  });

  it('opens both a PR and an Issue when the marker sits alongside real file changes', async () => {
    setupResult([
      [ISSUE_MARKER_PATH, '{"title":"Отдельная задача","body":"..."}'],
      ['new.txt', 'hello'],
    ]);
    const published = run();

    await service.publish(published, 6);

    expect(github.createIssue).toHaveBeenCalled();
    expect(github.createPull).toHaveBeenCalled();
    expect(published.status).toBe(LabRunStatus.PrOpen);
    expect(published.issueNumber).toBe(42);
    expect(published.prNumber).toBe(7);
  });

  it('fails the run without opening an Issue or PR when the marker is malformed', async () => {
    setupResult([[ISSUE_MARKER_PATH, 'not json']]);
    const failed = run();

    await service.publish(failed, 6);

    expect(github.createIssue).not.toHaveBeenCalled();
    expect(github.createPull).not.toHaveBeenCalled();
    expect(failed.status).toBe(LabRunStatus.Failed);
  });
});
