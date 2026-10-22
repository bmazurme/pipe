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
// The installer of the updates is never replaced by an update it carries out: if it were broken, the board would be left with no way
// to be fixed from here. It stays a manual copy.
export const NOT_UPDATABLE_PREFIXES = ['infra/boardagent/'];

export function isUpdatable(repoPath: string): boolean {
  return !NOT_UPDATABLE_PREFIXES.some((prefix) => repoPath.startsWith(prefix));
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
    const existing = await this.reports.findOne({
      where: { userId, host: dto.host },
    });
    const scripts: BoardScript[] = dto.scripts.map((script) => ({
      installed: script.installed,
      repoPath: script.repoPath,
      status: script.status,
      installedHash: script.installedHash ?? null,
      mainHash: script.mainHash ?? null,
    }));
    const outdated = scripts.filter((script) => script.status === 'outdated');
    const next = outdated.length > 0 ? key(dto.mainSha, outdated) : null;
    const hasPending = !!(await this.pendingRow(userId, dto.host));
    let announcedKey = existing?.announcedKey ?? null;

    if (next && next !== announcedKey && !hasPending) {
      announcedKey = next;
      await this.announce(dto.host, dto.mainSha, outdated);
    } else if (!next && announcedKey) {
      announcedKey = null;
      await this.notifier.send(
        `✅ Скрипты на ${dto.host} актуальны (main ${dto.mainSha.slice(0, 7)})`,
      );
    }

    await this.reports.save(
      this.reports.create({
        ...(existing ?? {}),
        userId,
        host: dto.host,
        reportedAt: new Date(),
        mainSha: dto.mainSha,
        agentVersion: dto.agentVersion ?? null,
        scripts,
        announcedKey,
      }),
    );
  }

  private async announce(
    host: string,
    sha: string,
    outdated: BoardScript[],
  ): Promise<void> {
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
      await this.notifier.send(lines.join('\n'));

      return;
    }

    await this.notifier.sendWithButtons(lines.join('\n'), [
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
