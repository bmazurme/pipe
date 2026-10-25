import { createHash } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { NotifyService } from '../telegram/notify.service';
import { BoardReportDto } from './dto/boards.dto';
import { BoardReport, BoardScript } from './entities/board-report.entity';
import { ScriptUpdate, ScriptUpdateVia } from './entities/script-update.entity';

// A board that has not reported for this long is shown as offline, and its report is too old to act on.
export const ONLINE_WITHIN_MS = 3 * 60 * 60 * 1000;
export const REPORT_FRESH_MS = 48 * 60 * 60 * 1000;
// A decision nobody picked up (the board is off) is dropped, so it cannot be applied by surprise much later.
export const PENDING_EXPIRES_MS = 60 * 60 * 1000;
// The agent can update itself — its script and its manifest, nothing else of infra/boardagent/ — because the agent checks the new
// version before replacing the running one, keeps the old, and a rollback unit restores it if the new one crashes. Everything else
// there (install.sh, rollback.sh, the units) stays a manual copy: rollback.sh in particular must not depend on what it restores.
export const SELF_UPDATABLE = [
  'infra/boardagent/board-agent.sh',
  'infra/boardagent/manifest.txt',
];

export function isUpdatable(repoPath: string): boolean {
  return (
    !repoPath.startsWith('infra/boardagent/') ||
    SELF_UPDATABLE.includes(repoPath)
  );
}

export interface BoardView {
  host: string;
  reportedAt: Date;
  online: boolean;
  mainSha: string;
  agentVersion: string | null;
  scripts: BoardScript[];
  outdated: number;
  updatable: number;
  pending: { id: number; sha: string; via: string; createdAt: Date } | null;
  lastUpdate: {
    id: number;
    status: string;
    sha: string;
    result: string | null;
    finishedAt: Date | null;
    createdAt: Date;
  } | null;
}

function key(sha: string, outdated: BoardScript[]): string {
  return createHash('sha256')
    .update(
      `${sha}\n${outdated
        .map((s) => s.repoPath)
        .sort()
        .join('\n')}`,
    )
    .digest('hex')
    .slice(0, 32);
}

@Injectable()
export class BoardsService {
  private readonly logger = new Logger(BoardsService.name);

  constructor(
    @InjectRepository(BoardReport)
    private readonly reports: Repository<BoardReport>,
    @InjectRepository(ScriptUpdate)
    private readonly updates: Repository<ScriptUpdate>,
    private readonly notifier: NotifyService,
  ) {}

  // The board's own account of itself. A board that stays outdated is announced once (with the button), and once more when it is
  // current again.
  async recordReport(userId: number, dto: BoardReportDto): Promise<void> {
    const scripts: BoardScript[] = dto.scripts.map((script) => ({
      installed: script.installed,
      repoPath: script.repoPath,
      status: script.status,
      installedHash: script.installedHash ?? null,
      mainHash: script.mainHash ?? null,
    }));
    const outdated = scripts.filter((script) => script.status === 'outdated');
    const next = outdated.length > 0 ? key(dto.mainSha, outdated) : null;

    // Saved first and without touching announcedKey: a slow Telegram must not hold the report back, and two overlapping reports
    // of a new board must not both INSERT.
    await this.reports.upsert(
      {
        userId,
        host: dto.host,
        reportedAt: new Date(),
        mainSha: dto.mainSha,
        agentVersion: dto.agentVersion ?? null,
        scripts,
      },
      ['userId', 'host'],
    );

    const previous =
      (await this.reports.findOne({ where: { userId, host: dto.host } }))
        ?.announcedKey ?? null;

    if (next && next !== previous) {
      if (await this.pendingRow(userId, dto.host)) return;
      if (!(await this.claim(userId, dto.host, next))) return;

      // The claim is released when Telegram did not take the message, so the next report retries.
      const sent = await this.safely(() =>
        this.announce(dto.host, dto.mainSha, outdated),
      );

      if (!sent) {
        await this.release(userId, dto.host, next, previous);
        this.logger.warn(
          `Could not announce outdated scripts on ${dto.host}; will retry on the next report`,
        );
      }
    } else if (!next && previous) {
      if (!(await this.claim(userId, dto.host, null))) return;

      const sent = await this.safely(() =>
        this.notifier.send(
          `✅ Скрипты на ${dto.host} актуальны (main ${dto.mainSha.slice(0, 7)})`,
        ),
      );

      if (!sent) {
        await this.release(userId, dto.host, null, previous);
        this.logger.warn(
          `Could not announce current scripts on ${dto.host}; will retry on the next report`,
        );
      }
    }
  }

  private async safely(send: () => Promise<boolean>): Promise<boolean> {
    try {
      return await send();
    } catch {
      return false;
    }
  }

  // Compare-and-set on announcedKey: true for the one request whose update changed the row, which is the one that sends.
  private async claim(
    userId: number,
    host: string,
    next: string | null,
  ): Promise<boolean> {
    const query = this.reports
      .createQueryBuilder()
      .update(BoardReport)
      .set({ announcedKey: next })
      .where('"userId" = :userId AND host = :host', { userId, host });

    if (next === null) {
      query.andWhere('"announcedKey" IS NOT NULL');
    } else {
      query.andWhere('"announcedKey" IS DISTINCT FROM :next', { next });
    }

    return ((await query.execute()).affected ?? 0) > 0;
  }

  // Gives the claim back, only if it is still ours.
  private async release(
    userId: number,
    host: string,
    claimed: string | null,
    previous: string | null,
  ): Promise<void> {
    const query = this.reports
      .createQueryBuilder()
      .update(BoardReport)
      .set({ announcedKey: previous })
      .where('"userId" = :userId AND host = :host', { userId, host });

    if (claimed === null) {
      query.andWhere('"announcedKey" IS NULL');
    } else {
      query.andWhere('"announcedKey" = :claimed', { claimed });
    }

    await query.execute();
  }

  private async announce(
    host: string,
    sha: string,
    outdated: BoardScript[],
  ): Promise<boolean> {
    const updatable = outdated.filter((script) => isUpdatable(script.repoPath));
    const manual = outdated.filter((script) => !isUpdatable(script.repoPath));
    const lines = [
      `⚠️ Скрипты на ${host} устарели относительно main (${sha.slice(0, 7)}):`,
      ...outdated.slice(0, 15).map((script) => `• ${script.repoPath}`),
      ...(outdated.length > 15 ? [`…и ещё ${outdated.length - 15}`] : []),
      ...(manual.length
        ? [
            '',
            'Вручную (scp + install): ' +
              manual.map((s) => s.repoPath).join(', '),
          ]
        : []),
    ];

    if (updatable.length === 0) {
      return this.notifier.send(lines.join('\n'));
    }

    return this.notifier.sendWithButtons(lines.join('\n'), [
      [
        {
          text: `⬆️ Обновить ${host}`,
          callback_data: `su:${host}:${sha.slice(0, 7)}`,
        },
      ],
    ]);
  }

  // ------------------------------------------------------------------ owner side

  async list(userId: number): Promise<BoardView[]> {
    const reports = await this.reports.find({
      where: { userId },
      order: { host: 'ASC' },
    });
    const now = Date.now();
    const views: BoardView[] = [];

    for (const report of reports) {
      const pending = await this.pendingRow(userId, report.host);
      const last = await this.updates.findOne({
        where: {
          userId,
          host: report.host,
          status: In(['applied', 'failed']),
        },
        order: { id: 'DESC' },
      });
      const outdated = report.scripts.filter((s) => s.status === 'outdated');

      views.push({
        host: report.host,
        reportedAt: report.reportedAt,
        online: now - report.reportedAt.getTime() < ONLINE_WITHIN_MS,
        mainSha: report.mainSha,
        agentVersion: report.agentVersion,
        scripts: report.scripts,
        outdated: outdated.length,
        updatable: outdated.filter((s) => isUpdatable(s.repoPath)).length,
        pending: pending
          ? {
              id: pending.id,
              sha: pending.sha,
              via: pending.via,
              createdAt: pending.createdAt,
            }
          : null,
        lastUpdate: last
          ? {
              id: last.id,
              status: last.status,
              sha: last.sha,
              result: last.result,
              finishedAt: last.finishedAt,
              createdAt: last.createdAt,
            }
          : null,
      });
    }

    return views;
  }

  // The owner's decision: bring this board's scripts to `main` as of the last report. `expectSha7` is what a Telegram button was made
  // for — a button from before `main` moved on is refused rather than applied to a different commit than the one the owner saw.
  async requestUpdate(
    userId: number,
    host: string,
    via: ScriptUpdateVia,
    expectSha7?: string,
  ): Promise<ScriptUpdate> {
    const report = await this.reports.findOne({ where: { userId, host } });

    if (!report) throw new NotFoundException('Плата не отчитывалась');
    if (Date.now() - report.reportedAt.getTime() > REPORT_FRESH_MS) {
      throw new ConflictException(
        'Плата давно не отчитывалась — дождитесь свежего отчёта',
      );
    }
    if (expectSha7 && !report.mainSha.startsWith(expectSha7)) {
      throw new ConflictException(
        'Кнопка устарела: main изменился — дождитесь нового сообщения',
      );
    }

    const repoPaths = report.scripts
      .filter((s) => s.status === 'outdated' && isUpdatable(s.repoPath))
      .map((s) => s.repoPath);

    if (repoPaths.length === 0) {
      throw new BadRequestException('Нечего обновлять автоматически');
    }

    // One decision at a time per board.
    await this.updates.update(
      { userId, host, status: 'pending' },
      { status: 'cancelled', finishedAt: new Date() },
    );

    return this.updates.save(
      this.updates.create({
        userId,
        host,
        sha: report.mainSha,
        repoPaths,
        status: 'pending',
        via,
        result: null,
        finishedAt: null,
      }),
    );
  }

  // The owner takes a decision back before the board collects it.
  async cancelPending(userId: number, host: string): Promise<void> {
    const row = await this.pendingRow(userId, host);

    if (!row) throw new NotFoundException('Нет ожидающего обновления');

    await this.updates.update(row.id, {
      status: 'cancelled',
      finishedAt: new Date(),
    });
    await this.notifier.send(`Обновление ${host} отменено`);
  }

  // A press on the Telegram button: only the owner's chat reaches this (see TelegramCommandsService). The board is found by name.
  async approveFromTelegram(host: string, sha7: string): Promise<string> {
    const report = await this.reports.findOne({
      where: { host },
      order: { reportedAt: 'DESC' },
    });

    if (!report) return `Плата ${host} не отчитывалась`;

    try {
      const update = await this.requestUpdate(
        report.userId,
        host,
        'telegram',
        sha7,
      );

      return `⬆️ Обновление ${host} до ${update.sha.slice(0, 7)} разрешено (${update.repoPaths.length} скрипт.). Плата применит его в течение пары минут.`;
    } catch (error) {
      return `⚠️ ${host}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // ------------------------------------------------------------------ board side

  // The decision waiting for this board, if any (and not older than an hour).
  async pendingFor(userId: number, host: string): Promise<ScriptUpdate | null> {
    return this.pendingRow(userId, host);
  }

  private async pendingRow(
    userId: number,
    host: string,
  ): Promise<ScriptUpdate | null> {
    const row = await this.updates.findOne({
      where: { userId, host, status: 'pending' },
      order: { id: 'DESC' },
    });

    if (!row) return null;
    if (Date.now() - row.createdAt.getTime() > PENDING_EXPIRES_MS) {
      await this.updates.update(row.id, {
        status: 'expired',
        finishedAt: new Date(),
      });

      return null;
    }

    return row;
  }

  async recordResult(
    userId: number,
    id: number,
    ok: boolean,
    message?: string,
  ): Promise<void> {
    const update = await this.updates.findOne({ where: { id, userId } });

    if (!update) throw new NotFoundException('Update not found');
    // A cancel can race with the agent having already collected the decision: the board's real outcome wins.
    if (update.status !== 'pending' && update.status !== 'cancelled') {
      throw new ConflictException('The update is already settled');
    }

    update.status = ok ? 'applied' : 'failed';
    update.result = message ?? null;
    update.finishedAt = new Date();
    await this.updates.save(update);

    // Re-announce is decided by the next report; forget the old key so a failed update is announced again.
    if (!ok) {
      await this.reports.update(
        { userId, host: update.host },
        { announcedKey: null },
      );
    }

    await this.notifier.send(
      ok
        ? `✅ Скрипты на ${update.host} обновлены до ${update.sha.slice(0, 7)} (${update.repoPaths.length})${message ? `\n${message.slice(0, 500)}` : ''}`
        : `🔴 Обновление скриптов на ${update.host} не удалось: ${(message ?? '').slice(0, 500)}`,
    );
    this.logger.log(
      `Board ${update.host}: update ${update.id} ${ok ? 'applied' : 'failed'}`,
    );
  }
}
