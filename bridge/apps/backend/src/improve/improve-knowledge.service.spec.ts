import { BadRequestException, ConflictException } from '@nestjs/common';

import type { AppLogService } from '../logs/app-log.service';
import type { GithubApiService } from '../loop/github-api.service';
import { ImproveKnowledgeService } from './improve-knowledge.service';

function setup(file: string | null = '# CLAUDE.md\n\nText.\n') {
  const blobs: Buffer[] = [];
  const github = {
    isReady: jest.fn().mockReturnValue(true),
    baseBranch: jest.fn().mockReturnValue('main'),
    getBranchSha: jest.fn().mockResolvedValue('base-sha'),
    getFileText: jest.fn().mockResolvedValue(file),
    getCommitTreeSha: jest.fn().mockResolvedValue('base-tree'),
    createBlob: jest.fn(async (bytes: Uint8Array) => {
      blobs.push(Buffer.from(bytes));

      return 'blob-sha';
    }),
    createTree: jest.fn().mockResolvedValue('tree-sha'),
    createCommit: jest.fn().mockResolvedValue('commit-sha'),
    createBranch: jest.fn().mockResolvedValue(undefined),
    createPull: jest.fn().mockResolvedValue({
      number: 77,
      htmlUrl: 'https://github.com/o/r/pull/77',
    }),
    addLabels: jest.fn().mockResolvedValue(undefined),
    deleteBranch: jest.fn().mockResolvedValue(undefined),
  };
  const appLogs = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ImproveKnowledgeService(
    github as unknown as GithubApiService,
    appLogs as unknown as AppLogService,
  );

  return { service, github, appLogs, blobs };
}

const input = {
  title: 'Порт reports',
  text: 'Сервер слушает :4000.',
  target: 'claude-md' as const,
  source: 'вопрос 12-3',
};

describe('ImproveKnowledgeService', () => {
  it('commits the file with the entry on a new branch off the base and opens a labelled pull request', async () => {
    const { service, github, blobs } = setup();

    const saved = await service.save(1, input);

    expect(github.getFileText).toHaveBeenCalledWith('CLAUDE.md', 'base-sha');
    expect(blobs[0].toString('utf-8')).toBe(
      '# CLAUDE.md\n\nText.\n\n## Постоянные знания\n\n- **Порт reports.** Сервер слушает :4000.\n',
    );
    expect(github.createTree).toHaveBeenCalledWith('base-tree', [
      { path: 'CLAUDE.md', mode: '100644', type: 'blob', sha: 'blob-sha' },
    ]);
    expect(github.createCommit).toHaveBeenCalledWith(
      expect.stringContaining('Knowledge: Порт reports'),
      'tree-sha',
      'base-sha',
    );
    expect(github.createBranch).toHaveBeenCalledWith(
      expect.stringMatching(/^knowledge\//),
      'commit-sha',
    );

    const pull = github.createPull.mock.calls[0][0];

    expect(pull).toMatchObject({
      title: 'Знание: Порт reports',
      base: 'main',
      head: saved.branch,
    });
    expect(pull.body).toContain('источник: вопрос 12-3');
    expect(pull.body).toContain('> **Порт reports**');
    expect(github.addLabels).toHaveBeenCalledWith(77, ['loop', 'risk:low']);
    expect(saved).toMatchObject({
      number: 77,
      url: 'https://github.com/o/r/pull/77',
      path: 'CLAUDE.md',
    });
  });

  it('creates docs/knowledge.md when it does not exist', async () => {
    const { service, github, blobs } = setup(null);

    await service.save(1, { ...input, target: 'docs' });

    expect(github.getFileText).toHaveBeenCalledWith(
      'docs/knowledge.md',
      'base-sha',
    );
    expect(blobs[0].toString('utf-8').startsWith('# Постоянные знания')).toBe(
      true,
    );
  });

  it('writes nothing when GitHub is not set up, the entry is not acceptable or already there', async () => {
    const off = setup();

    off.github.isReady.mockReturnValue(false);
    await expect(off.service.save(1, input)).rejects.toThrow(
      BadRequestException,
    );

    const key = setup();

    await expect(
      key.service.save(1, { ...input, text: 'ghp_AbCdEfGhIjKlMnOpQrSt1234' }),
    ).rejects.toThrow(/похоже на ключ/);
    expect(key.github.getBranchSha).not.toHaveBeenCalled();

    const twice = setup(
      '# X\n\n## Постоянные знания\n\n- **Порт reports.** Сервер слушает :4000.\n',
    );

    await expect(twice.service.save(1, input)).rejects.toThrow(
      ConflictException,
    );
    expect(twice.github.createBranch).not.toHaveBeenCalled();
  });

  it('removes the branch when the pull request cannot be opened, and lets the next save through', async () => {
    const { service, github } = setup();

    github.createPull.mockRejectedValueOnce(new Error('GitHub 422'));

    await expect(service.save(1, input)).rejects.toThrow('GitHub 422');
    expect(github.deleteBranch).toHaveBeenCalledWith(
      github.createBranch.mock.calls[0][0],
    );

    await expect(service.save(1, input)).resolves.toMatchObject({ number: 77 });
  });

  it('does not let two saves run at once', async () => {
    const { service, github } = setup();
    let release: (sha: string) => void = () => undefined;

    github.getBranchSha.mockReturnValueOnce(
      new Promise<string>((resolve) => (release = resolve)),
    );

    const first = service.save(1, input);

    await expect(service.save(1, input)).rejects.toThrow(ConflictException);

    release('base-sha');
    await expect(first).resolves.toMatchObject({ number: 77 });
  });

  it('still answers when labelling the pull request fails', async () => {
    const { service, github } = setup();

    github.addLabels.mockRejectedValueOnce(new Error('nope'));

    await expect(service.save(1, input)).resolves.toMatchObject({ number: 77 });
  });
});
