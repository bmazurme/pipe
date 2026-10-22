import { BadRequestException } from '@nestjs/common';

import { LabProject } from './entities/lab-project.entity';
import { checkRepo, RepoCheck } from './lab-github';
import { LabProjectsService, toView } from './lab-projects.service';

jest.mock('./lab-github', () => ({
  ...jest.requireActual<typeof import('./lab-github')>('./lab-github'),
  checkRepo: jest.fn(),
}));

const checkRepoMock = checkRepo as jest.MockedFunction<typeof checkRepo>;

const passing = (over: Partial<RepoCheck> = {}): RepoCheck => ({
  canRead: true,
  branchFound: true,
  canWrite: true,
  defaultBranch: 'main',
  isPrivate: true,
  problems: [],
  ...over,
});

const makeProject = (over: Partial<LabProject> = {}): LabProject =>
  ({
    id: 3,
    userId: 7,
    name: 'Лодка',
    repo: 'me/boat',
    baseBranch: 'main',
    token: 'ghp_oldtoken1234',
    tokenHint: '1234',
    checkedAt: null,
    canWrite: true,
    ...over,
  }) as LabProject;

const setup = (project: LabProject = makeProject()) => {
  const repo = {
    findOne: jest.fn().mockResolvedValue(project),
    create: jest.fn((input: Partial<LabProject>) => ({ id: 9, ...input })),
    save: jest.fn((entity: LabProject) => Promise.resolve(entity)),
  };
  const service = new LabProjectsService(repo as never);

  return { service, repo, project };
};

beforeEach(() => checkRepoMock.mockReset());

describe('LabProjectsService.create', () => {
  it('rejects a repository that is not owner/name without asking GitHub', async () => {
    const { service, repo } = setup();

    await expect(
      service.create(7, { name: 'x', repo: 'boat', token: 'tok' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(checkRepoMock).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects a token that cannot read the repository, with the reason', async () => {
    checkRepoMock.mockResolvedValue(
      passing({
        canRead: false,
        branchFound: false,
        canWrite: false,
        problems: ['GitHub не принял токен (401): он неверный или истёк'],
      }),
    );
    const { service, repo } = setup();

    await expect(
      service.create(7, { name: 'x', repo: 'me/boat', token: 'bad' }),
    ).rejects.toThrow('GitHub не принял токен (401)');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('stores the last 4 characters as tokenHint and never returns the token', async () => {
    checkRepoMock.mockResolvedValue(passing({ canWrite: false }));
    const { service, repo } = setup();

    const view = await service.create(7, {
      name: 'x',
      repo: 'me/boat',
      token: 'ghp_secretABCD',
    });

    expect(checkRepoMock).toHaveBeenCalledWith(
      'me/boat',
      'ghp_secretABCD',
      'main',
    );
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'ghp_secretABCD', tokenHint: 'ABCD' }),
    );
    expect(view).toMatchObject({ tokenHint: 'ABCD', canWrite: false });
    expect(view).not.toHaveProperty('token');
  });
});

describe('toView', () => {
  it('strips the token and keeps everything else', () => {
    const view = toView(makeProject());

    expect(view).not.toHaveProperty('token');
    expect(view).toMatchObject({ id: 3, repo: 'me/boat', tokenHint: '1234' });
  });
});

describe('LabProjectsService.update', () => {
  it('refuses a token GitHub rejects and keeps the stored one', async () => {
    checkRepoMock.mockResolvedValue(
      passing({
        canRead: false,
        branchFound: false,
        canWrite: false,
        problems: ['GitHub не принял токен (401): он неверный или истёк'],
      }),
    );
    const { service, repo, project } = setup();

    await expect(
      service.update(3, 7, { token: 'ghp_typo9999' }),
    ).rejects.toThrow('GitHub не принял токен (401)');
    expect(checkRepoMock).toHaveBeenCalledWith(
      'me/boat',
      'ghp_typo9999',
      'main',
    );
    expect(repo.save).not.toHaveBeenCalled();
    expect(project.token).toBe('ghp_oldtoken1234');
    expect(project.tokenHint).toBe('1234');
  });

  it('refuses a base branch that does not exist and keeps the stored one', async () => {
    checkRepoMock.mockResolvedValue(
      passing({
        branchFound: false,
        problems: ['Ветка «nope» не найдена (ветка по умолчанию — «main»)'],
      }),
    );
    const { service, repo, project } = setup();

    await expect(service.update(3, 7, { baseBranch: 'nope' })).rejects.toThrow(
      'Ветка «nope» не найдена',
    );
    expect(checkRepoMock).toHaveBeenCalledWith(
      'me/boat',
      'ghp_oldtoken1234',
      'nope',
    );
    expect(repo.save).not.toHaveBeenCalled();
    expect(project.baseBranch).toBe('main');
  });

  it('saves a token that passes, with the new canWrite', async () => {
    checkRepoMock.mockResolvedValue(passing({ canWrite: false }));
    const { service, repo } = setup();

    const view = await service.update(3, 7, { token: 'ghp_newtokenWXYZ' });

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'ghp_newtokenWXYZ',
        tokenHint: 'WXYZ',
        canWrite: false,
        checkedAt: expect.any(Date) as Date,
      }),
    );
    expect(view).not.toHaveProperty('token');
  });

  it('renames without asking GitHub', async () => {
    const { service, repo } = setup();

    const view = await service.update(3, 7, { name: 'Яхта' });

    expect(checkRepoMock).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Яхта', token: 'ghp_oldtoken1234' }),
    );
    expect(view.name).toBe('Яхта');
  });
});
