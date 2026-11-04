import { BadRequestException } from '@nestjs/common';

import { LabProject } from './entities/lab-project.entity';
import * as labGithub from './lab-github';
import { LabKnowledgeService } from './lab-knowledge.service';
import * as zip from '../common/zip';

describe('LabKnowledgeService', () => {
  const project = {
    id: 3,
    userId: 1,
    repo: 'owner/repo',
    token: 'ghp_x',
    baseBranch: 'main',
    canWrite: true,
  } as LabProject;
  let github: Record<string, jest.Mock>;
  let chunks: Record<string, jest.Mock>;
  let projects: { findOwned: jest.Mock };
  let service: LabKnowledgeService;

  beforeEach(() => {
    github = {
      getBranchSha: jest.fn().mockResolvedValue('sha-1'),
    };
    jest.spyOn(labGithub, 'githubFor').mockReturnValue(github as never);
    jest
      .spyOn(labGithub, 'downloadRepoZip')
      .mockResolvedValue(new Uint8Array());
    projects = { findOwned: jest.fn().mockResolvedValue(project) };
    chunks = {
      delete: jest.fn().mockResolvedValue(undefined),
      save: jest
        .fn()
        .mockImplementation((rows: unknown[]) => Promise.resolve(rows)),
      create: jest.fn().mockImplementation((rows: unknown) => rows),
      find: jest.fn().mockResolvedValue([]),
    };
    service = new LabKnowledgeService(chunks as never, projects as never);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('reindex', () => {
    it('chunks every markdown file the repo zip has and replaces the project chunks wholesale', async () => {
      // readZipball is mocked wholesale here, so this fixture stands in for what the real `accept` filter would
      // have already narrowed down to — that filter's own behavior is covered by the next test.
      jest.spyOn(zip, 'readZipball').mockResolvedValue([
        {
          path: 'DECISIONS.md',
          bytes: new TextEncoder().encode('# D-001\nUse foam core.'),
        },
      ]);

      const result = await service.reindex(3, 1);

      expect(chunks.delete).toHaveBeenCalledWith({ projectId: 3 });
      expect(chunks.create).toHaveBeenCalledWith([
        {
          projectId: 3,
          path: 'DECISIONS.md',
          heading: 'D-001',
          chunkIndex: 0,
          content: '# D-001\nUse foam core.',
        },
      ]);
      expect(result).toEqual({ files: 1, chunks: 1 });
    });

    it('only accepts .md files from the zip, case-insensitively', async () => {
      const accept = jest.spyOn(zip, 'readZipball').mockResolvedValue([]);

      await service.reindex(3, 1);

      const filter = accept.mock.calls[0][1] as (
        path: string,
        size: number,
      ) => boolean;

      expect(filter('DECISIONS.md', 100)).toBe(true);
      expect(filter('Plan.MD', 100)).toBe(true);
      expect(filter('image.png', 100)).toBe(false);
      expect(filter('huge.md', 10 * 1024 * 1024)).toBe(false);
    });

    it('produces no chunks and no rows when the repo has no markdown', async () => {
      jest.spyOn(zip, 'readZipball').mockResolvedValue([]);

      const result = await service.reindex(3, 1);

      expect(chunks.delete).toHaveBeenCalledWith({ projectId: 3 });
      expect(chunks.create).not.toHaveBeenCalled();
      expect(result).toEqual({ files: 0, chunks: 0 });
    });

    it('wraps a GitHub failure in a BadRequestException with a readable message', async () => {
      github.getBranchSha.mockRejectedValue(
        new Error('GitHub 404 при чтении репозитория'),
      );

      await expect(service.reindex(3, 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('ask', () => {
    it('rejects an empty question without touching the repository', async () => {
      await expect(service.ask(3, 1, '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(chunks.find).not.toHaveBeenCalled();
    });

    it('rejects a question over the length limit', async () => {
      await expect(service.ask(3, 1, 'x'.repeat(501))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('ranks stored chunks by the question and returns path, heading, content and score', async () => {
      chunks.find.mockResolvedValue([
        {
          path: 'DECISIONS.md',
          heading: 'D-001',
          content: 'Hull uses a foam core composite.',
        },
        {
          path: 'BOM.md',
          heading: 'Battery',
          content: 'Battery pack weighs 300 grams.',
        },
      ]);

      const matches = await service.ask(3, 1, 'hull composite material');

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        path: 'DECISIONS.md',
        heading: 'D-001',
      });
      expect(matches[0].score).toBeGreaterThan(0);
    });

    it('throws NotFoundException for a project owned by someone else (via findOwned)', async () => {
      projects.findOwned.mockRejectedValue(new Error('Project not found'));

      await expect(service.ask(3, 99, 'hull')).rejects.toThrow(
        'Project not found',
      );
    });
  });

  describe('status', () => {
    it('counts distinct files and total chunks for the project', async () => {
      chunks.find.mockResolvedValue([
        { path: 'DECISIONS.md' },
        { path: 'DECISIONS.md' },
        { path: 'BOM.md' },
      ]);

      await expect(service.status(3, 1)).resolves.toEqual({
        chunks: 3,
        files: 2,
      });
    });
  });
});
