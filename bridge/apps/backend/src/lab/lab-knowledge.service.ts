import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { readZipball } from '../common/zip';
import { rankByQuery } from '../common/tfidf-rank';
import { utf8Text } from '../improve/parcel';
import { chunkMarkdown } from './chunk-markdown';
import { LabDocumentChunk } from './entities/lab-document-chunk.entity';
import {
  describeGithubError,
  downloadRepoZip,
  githubFor,
  readStep,
} from './lab-github';
import { LabProjectsService } from './lab-projects.service';

// A document this big is already unusual for a decision log or spec — matches the ceiling Improve puts on a
// single text file of its own snapshot.
const MAX_FILE_BYTES = 256 * 1024;
// Caps the cost of a reindex and of ranking at query time; a project's own markdown docs do not realistically
// approach this — it exists to bound a pathological repository, not to model expected use.
const MAX_CHUNKS_PER_PROJECT = 500;
const DEFAULT_MATCHES = 5;
const MAX_QUESTION_LENGTH = 500;

export interface LabKnowledgeMatch {
  path: string;
  heading: string | null;
  content: string;
  score: number;
}

export interface LabKnowledgeStatus {
  files: number;
  chunks: number;
}

// Indexes a Lab project's own markdown files (decision logs, specs, READMEs — whatever it keeps in .md) so a
// question about them can be answered in seconds, ranked by TF-IDF cosine similarity (see common/tfidf-rank.ts
// for why not a real embeddings model), without spinning up a full worker run just to re-read a file. Reuses the
// project's own stored token and the exact same repo-zip download lab-runs.service.ts already does for a run's
// snapshot — this never touches worker/job infrastructure at all.
@Injectable()
export class LabKnowledgeService {
  constructor(
    @InjectRepository(LabDocumentChunk)
    private readonly chunks: Repository<LabDocumentChunk>,
    private readonly projects: LabProjectsService,
  ) {}

  async status(projectId: number, userId: number): Promise<LabKnowledgeStatus> {
    await this.projects.findOwned(projectId, userId);

    const rows = await this.chunks.find({
      where: { projectId },
      select: { path: true },
    });

    return {
      chunks: rows.length,
      files: new Set(rows.map((row) => row.path)).size,
    };
  }

  // Re-downloads the repository's markdown files at its current base branch and replaces the project's chunks
  // wholesale — simpler and, at this file count, cheaper than diffing which file changed since the last index.
  async reindex(
    projectId: number,
    userId: number,
  ): Promise<LabKnowledgeStatus> {
    const project = await this.projects.findOwned(projectId, userId);

    try {
      const github = githubFor(project);
      const sha = await readStep(`ветка ${project.baseBranch}`, () =>
        github.getBranchSha(project.baseBranch),
      );
      const zip = await readStep('скачивание репозитория', () =>
        downloadRepoZip(project.repo, project.token, sha),
      );
      const files = await readZipball(
        zip,
        (path, size) =>
          path.toLowerCase().endsWith('.md') &&
          size > 0 &&
          size <= MAX_FILE_BYTES,
      );

      const rows: Pick<
        LabDocumentChunk,
        'projectId' | 'path' | 'heading' | 'chunkIndex' | 'content'
      >[] = [];

      for (const file of files) {
        if (rows.length >= MAX_CHUNKS_PER_PROJECT) break;

        const sections = chunkMarkdown(utf8Text(file.bytes));

        for (const [index, section] of sections.entries()) {
          if (rows.length >= MAX_CHUNKS_PER_PROJECT) break;

          rows.push({
            projectId,
            path: file.path,
            heading: section.heading,
            chunkIndex: index,
            content: section.content,
          });
        }
      }

      await this.chunks.delete({ projectId });
      if (rows.length) await this.chunks.save(this.chunks.create(rows));

      return { files: files.length, chunks: rows.length };
    } catch (error) {
      throw new BadRequestException(describeGithubError(error));
    }
  }

  async ask(
    projectId: number,
    userId: number,
    question: string,
    limit = DEFAULT_MATCHES,
  ): Promise<LabKnowledgeMatch[]> {
    await this.projects.findOwned(projectId, userId);

    const trimmed = question.trim();

    if (!trimmed) throw new BadRequestException('Укажите вопрос');
    if (trimmed.length > MAX_QUESTION_LENGTH) {
      throw new BadRequestException(
        `Вопрос длиннее ${MAX_QUESTION_LENGTH} символов`,
      );
    }

    const rows = await this.chunks.find({ where: { projectId } });
    const ranked = rankByQuery(
      trimmed,
      rows.map((row) => ({
        text: `${row.heading ?? ''}\n${row.content}`,
        item: row,
      })),
      limit,
    );

    return ranked.map(({ item, score }) => ({
      path: item.path,
      heading: item.heading,
      content: item.content,
      score,
    }));
  }
}
