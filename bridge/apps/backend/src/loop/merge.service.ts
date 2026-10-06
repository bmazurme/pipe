import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TelegramService } from '../telegram/telegram.service';
import { GithubApiService, PullInfo } from './github-api.service';
import { LOOP_PR_LABEL } from './github-events';
import { findProtected } from './protected-paths';

export type MergeVerdict =
  | { ok: true; pr: PullInfo }
  // `manual`: refused for a reason a human must resolve on GitHub (protected
  // paths) — no merge button is ever offered for it.
  | { ok: false; reason: string; pr?: PullInfo; manual?: boolean };

// The one place a merge can happen, and the loop's enforced safety boundary:
// every rule is re-checked against GitHub at the moment of the click — the
// message the button sat in may be minutes old, and nothing said in it is
// trusted. Approval is per merge and pinned to the head sha that was shown.
@Injectable()
export class MergeService {
  private readonly logger = new Logger(MergeService.name);

  constructor(
    private readonly github: GithubApiService,
    private readonly telegram: TelegramService,
    private readonly configService: ConfigService,
  ) {}

  async evaluate(number: number, expectedSha?: string): Promise<MergeVerdict> {
    if (!this.github.isConfigured()) {
      return {
        ok: false,
        reason: 'merge из Telegram не настроен (нет LOOP_GITHUB_TOKEN)',
      };
    }

    const pr = await this.github.getPull(number);
    const base = this.configService.get<string>('GITHUB_BASE_BRANCH') || 'main';

    if (pr.merged) return { ok: false, pr, reason: 'PR уже влит' };
    if (pr.state !== 'open') return { ok: false, pr, reason: 'PR закрыт' };
    if (pr.draft) return { ok: false, pr, reason: 'PR в статусе draft' };
    if (!pr.labels.includes(LOOP_PR_LABEL)) {
      return { ok: false, pr, reason: `у PR нет метки «${LOOP_PR_LABEL}»` };
    }
    if (pr.baseRef !== base) {
      return { ok: false, pr, reason: `PR не в ${base}, а в ${pr.baseRef}` };
    }
    if (expectedSha && !pr.headSha.startsWith(expectedSha)) {
      return {
        ok: false,
        pr,
        reason: 'PR изменился после запроса подтверждения — запросите заново',
      };
    }

    const hits = findProtected(await this.github.listPullFiles(number));

    if (hits.length > 0) {
      return {
        ok: false,
        pr,
        manual: true,
        reason: `затронуты защищённые пути (${hits.slice(0, 5).join(', ')}) — только ручной merge на GitHub`,
      };
    }

    const ci = await this.github.ciState(pr.headSha);

    if (ci !== 'success') {
      return {
        ok: false,
        pr,
        reason:
          ci === 'pending'
            ? 'CI ещё не завершён'
            : ci === 'none'
              ? 'для коммита нет проверок CI'
              : 'CI не зелёный',
      };
    }

    if (pr.mergeable === false) {
      return { ok: false, pr, reason: 'есть конфликты с main' };
    }

    return { ok: true, pr };
  }

  // CI went green on a loop PR: tell the owner and, if the PR would pass every
  // check, attach the merge button. Never merges anything by itself.
  async offer(number: number): Promise<void> {
    let verdict: MergeVerdict;

    try {
      verdict = await this.evaluate(number);
    } catch (error) {
      this.logger.warn(`offer #${number} failed: ${errorMessage(error)}`);
      await this.telegram.send(
        `🟢 CI зелёный на PR #${number}, но проверить его не удалось: ${errorMessage(error)}`,
      );
      return;
    }

    if (verdict.ok) {
      const { pr } = verdict;

      await this.telegram.sendWithButtons(
        `🟢 CI зелёный: PR #${pr.number} «${pr.title}»\nПроверки пройдены. Влить в ${pr.baseRef} (squash)?`,
        [
          [
            {
              text: '✅ Merge',
              callback_data: `merge:${pr.number}:${pr.headSha.slice(0, 7)}`,
            },
            { text: '🔎 Открыть PR', url: pr.htmlUrl },
          ],
        ],
      );

      return;
    }

    const link = verdict.pr ? `\n${verdict.pr.htmlUrl}` : '';

    await this.telegram.send(
      `🟢 CI зелёный на PR #${number}, но merge из Telegram недоступен: ${verdict.reason}${link}`,
    );
  }

  // Runs on the owner's button press. Returns the text to show them.
  async merge(number: number, sha7: string): Promise<string> {
    try {
      const verdict = await this.evaluate(number, sha7);

      if (!verdict.ok) {
        return `⛔ PR #${number} не влит: ${verdict.reason}`;
      }

      await this.github.merge(number, verdict.pr.headSha);

      return `✅ PR #${number} влит в ${verdict.pr.baseRef} (squash)`;
    } catch (error) {
      this.logger.warn(`merge #${number} failed: ${errorMessage(error)}`);

      return `⛔ PR #${number} не влит: ${errorMessage(error)}`;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
