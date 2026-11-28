import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';

import { AppLogService } from '../logs/app-log.service';
import { GithubApiService } from '../loop/github-api.service';
import { buildResultTree, message, PR_LABEL } from './improve-shared';
import {
  addKnowledge,
  checkEntry,
  KNOWLEDGE_TARGETS,
  knowledgeBranch,
  type KnowledgeTarget,
} from './knowledge';
import { assessRisk, describeRisk, RISK_LABELS } from './pr-risk';

export interface SavedKnowledge {
  number: number;
  url: string;
  branch: string;
  path: string;
}

// A8: «сохранить как постоянное знание» — the entry becomes a pull request that adds it to CLAUDE.md or
// docs/knowledge.md. No worker and no model: the owner wrote (or edited) the wording, bridge only puts it in
// the right place, so the pull request is exactly what was reviewed in the dialog. The owner accepts it like
// any other one (CI → Telegram → merge); nothing is written to the repository without that.
@Injectable()
export class ImproveKnowledgeService {
  private readonly logger = new Logger(ImproveKnowledgeService.name);
  // One save at a time: a double click must not open two pull requests with the same entry.
  private saving = false;

  constructor(
    private readonly github: GithubApiService,
    private readonly appLogs: AppLogService,
  ) {}

  async save(
    userId: number,
    input: {
      title: string;
      text: string;
      target: KnowledgeTarget;
      source?: string;
    },
  ): Promise<SavedKnowledge> {
    if (!this.github.isReady()) {
      throw new BadRequestException(
        'GitHub не настроен: задайте GITHUB_REPO и LOOP_GITHUB_TOKEN на bridge',
      );
    }

    const entry = checkEntry(input);
    const { path } = KNOWLEDGE_TARGETS[input.target];

    if (this.saving) {
      throw new ConflictException('Другое знание сейчас записывается');
    }

    this.saving = true;

    try {
      const baseSha = await this.github.getBranchSha(this.github.baseBranch());
      const current = await this.github.getFileText(path, baseSha);
      const next = addKnowledge(current, input.target, entry);
      const commit = await this.github.createCommit(
        `Knowledge: ${entry.title}\n\nSaved from bridge (A8).`,
        await buildResultTree(this.github, baseSha, [
          {
            path,
            kind: current === null ? 'added' : 'modified',
            bytes: Buffer.from(next, 'utf-8'),
          },
        ]),
        baseSha,
      );
      const branch = knowledgeBranch(entry.title, Date.now());
      const risk = assessRisk([path]);

      await this.github.createBranch(branch, commit);

      let pull: { number: number; htmlUrl: string };

      try {
        pull = await this.github.createPull({
          title: `Знание: ${entry.title}`.slice(0, 200),
          head: branch,
          base: this.github.baseBranch(),
          body: [
            `Постоянное знание для \`${path}\`${input.source ? ` (источник: ${input.source})` : ''}:`,
            '',
            `> **${entry.title}**`,
            ...entry.text.split('\n').map((line) => `> ${line}`),
            '',
            describeRisk(risk),
            '',
            'Записано кнопкой «В репозиторий» (bridge, A8). Не влито автоматически — проверьте формулировку и влейте как обычно (CI → Telegram → Merge).',
          ].join('\n'),
        });
      } catch (error) {
        // A branch with no pull request helps nobody.
        await this.github
          .deleteBranch(branch)
          .catch((cleanup) =>
            this.logger.warn(
              `Could not remove branch ${branch} after a failed PR: ${message(cleanup)}`,
            ),
          );

        throw error;
      }

      await this.github
        .addLabels(pull.number, [PR_LABEL, RISK_LABELS[risk.risk]])
        .catch((error) =>
          this.logger.warn(
            `Could not label PR #${pull.number}: ${message(error)}`,
          ),
        );

      void this.appLogs.record({
        level: 'info',
        source: 'loop',
        event: 'knowledge.saved',
        message: `Знание записано в ${path}: PR #${pull.number}`,
        meta: { path, pr: pull.number, userId },
      });

      return { number: pull.number, url: pull.htmlUrl, branch, path };
    } finally {
      this.saving = false;
    }
  }
}
