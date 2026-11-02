import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';

import { TelegramService } from '../telegram/telegram.service';
import { RouterReportDto, RouterRebootResultDto } from './dto/router.dto';
import { RouterReport } from './entities/router-report.entity';
import {
  RouterReboot,
  RouterRebootStatus,
} from './entities/router-reboot.entity';
import {
  assessRouter,
  RouterAssessment,
  RouterData,
  ROUTER_STALE_AFTER_MS,
} from './router';

const MINUTE = 60_000;
// A request nobody took (the agent is down) is dropped, so it cannot reboot the router by surprise much later.
export const REBOOT_PENDING_MS = 10 * MINUTE;
// The agent took it and never said how it went (it died, or the router did not come back and it gave up silently).
export const REBOOT_TAKEN_MS = 10 * MINUTE;
// No new request this soon after the previous one: a router that does not come back is not helped by the fifth press.
export const REBOOT_MIN_GAP_MS = 5 * MINUTE;

export interface RouterView extends RouterAssessment {
  host: string;
  reportedAt: string;
  data: RouterData;
  // The newest reboot asked for through Telegram, if any.
  reboot: {
    status: RouterRebootStatus;
    at: string;
    result: string | null;
  } | null;
}

@Injectable()
export class RouterService {
  constructor(
    @InjectRepository(RouterReport)
    private readonly reports: Repository<RouterReport>,
    @InjectRepository(RouterReboot)
    private readonly reboots: Repository<RouterReboot>,
    private readonly telegram: TelegramService,
  ) {}

  // ------------------------------------------------------------------ agent side

  // The agent's account of the router. Only the latest is kept: the Dashboard shows now, not history. The answer carries the reboot the owner
  // asked for, if one is waiting (taken at most once: compare-and-set on the status).
  async record(
    userId: number,
    dto: RouterReportDto,
    now = new Date(),
  ): Promise<{ rebootRequestId: number | null }> {
    await this.reports.upsert(
      {
        userId,
        host: dto.host,
        reportedAt: now,
        data: dto as unknown as RouterData,
      },
      ['userId', 'host'],
    );
    await this.expireStale(userId, dto.host, now);

    // The agent cannot reboot what it cannot log in to: the request stays for it until it can (or expires).
    if (!dto.sshOk) return { rebootRequestId: null };

    const pending = await this.reboots.findOne({
      where: { userId, host: dto.host, status: 'pending' },
      order: { id: 'ASC' },
    });

    if (!pending) return { rebootRequestId: null };

    const taken = await this.reboots.update(
      { id: pending.id, status: 'pending' },
      { status: 'taken', takenAt: now },
    );

    return { rebootRequestId: taken.affected === 1 ? pending.id : null };
  }

  // The agent's verdict on a reboot it took. Tells the owner.
  async finish(
    userId: number,
    id: number,
    dto: RouterRebootResultDto,
    now = new Date(),
  ): Promise<void> {
    const status: RouterRebootStatus = dto.ok ? 'done' : 'failed';
    const result = await this.reboots.update(
      { id, userId, status: 'taken' },
      { status, finishedAt: now, result: dto.detail ?? null },
    );

    if (result.affected !== 1) {
      throw new NotFoundException('No such reboot request, or it is closed');
    }

    await this.telegram.send(
      dto.ok
        ? `✅ Роутер перезагружен${dto.detail ? `: ${dto.detail}` : '.'}`
        : `⚠️ Перезагрузить роутер не удалось${dto.detail ? `: ${dto.detail}` : '.'}`,
    );
  }

  // ------------------------------------------------------------------ the owner's side

  async list(userId: number, now = new Date()): Promise<RouterView[]> {
    const rows = await this.reports.find({
      where: { userId },
      order: { host: 'ASC' },
    });

    return Promise.all(
      rows.map(async (row) => {
        const last = await this.reboots.findOne({
          where: { userId, host: row.host },
          order: { id: 'DESC' },
        });

        return {
          host: row.host,
          reportedAt: row.reportedAt.toISOString(),
          data: row.data,
          ...assessRouter(row.data, row.reportedAt, now),
          reboot: last
            ? {
                status: last.status,
                at: (last.finishedAt ?? last.createdAt).toISOString(),
                result: last.result,
              }
            : null,
        };
      }),
    );
  }

  // The text of /router. The deployment has one owner, so the newest report of any account is the router's.
  async statusText(now = new Date()): Promise<string> {
    const report = await this.latestReport();

    if (!report) {
      return 'Роутер ещё ни разу не отчитывался: агент на плате не настроен (infra/router).';
    }

    const verdict = assessRouter(report.data, report.reportedAt, now);
    const { data } = report;
    const minutes = Math.round(
      (now.getTime() - report.reportedAt.getTime()) / MINUTE,
    );
    const lines = [
      `${verdict.status === 'ok' ? '✅' : verdict.status === 'warn' ? '⚠️' : '🛑'} Роутер ${report.host}: ${
        verdict.status === 'ok'
          ? 'в порядке'
          : verdict.status === 'warn'
            ? 'есть замечания'
            : 'проблема'
      }`,
      ...verdict.reasons.map((reason) => `• ${reason}`),
    ];
    const facts = [
      data.wanIp ? `внешний адрес ${data.wanIp}` : null,
      data.pingMs != null ? `пинг ${Math.round(data.pingMs)} мс` : null,
      data.uptimeSec != null
        ? `работает ${Math.floor(data.uptimeSec / 3600)} ч ${Math.floor((data.uptimeSec % 3600) / 60)} мин`
        : null,
    ].filter(Boolean);

    if (facts.length) lines.push(facts.join(' · '));
    lines.push(`Отчёт ${minutes < 1 ? 'только что' : `${minutes} мин назад`}.`);

    return lines.join('\n');
  }

  // A press on the confirmed Telegram button. Says in words why it did not ask for a reboot.
  async requestFromTelegram(now = new Date()): Promise<string> {
    const report = await this.latestReport();

    if (!report) {
      return 'Роутер ещё ни разу не отчитывался: агент на плате не настроен (infra/router). Перезагрузка не запрошена.';
    }

    const { userId, host, data } = report;
    const age = now.getTime() - report.reportedAt.getTime();

    if (age > ROUTER_STALE_AFTER_MS) {
      return `⚠️ Данные о роутере устарели (${Math.round(age / MINUTE)} мин): агент на плате не работает и запрос не заберёт. Перезагрузка не запрошена.`;
    }
    if (!data.reachable) {
      return '⚠️ Роутер не отвечает на ping: по SSH его не перезагрузить. Нужно обесточить его вручную (или умной розеткой). Перезагрузка не запрошена.';
    }
    if (!data.sshOk) {
      return '⚠️ Агент не может войти на роутер по SSH (ключ?). Перезагрузка не запрошена.';
    }

    await this.expireStale(userId, host, now);

    const active = await this.reboots.findOne({
      where: { userId, host, status: In(['pending', 'taken']) },
    });

    if (active) {
      return 'Перезагрузка роутера уже запрошена и выполняется. Напишу, когда он вернётся.';
    }

    const last = await this.reboots.findOne({
      where: { userId, host },
      order: { id: 'DESC' },
    });

    if (last && now.getTime() - last.createdAt.getTime() < REBOOT_MIN_GAP_MS) {
      const wait = Math.ceil(
        (REBOOT_MIN_GAP_MS - (now.getTime() - last.createdAt.getTime())) /
          MINUTE,
      );

      return `Роутер только что перезагружали. Повторить можно примерно через ${wait} мин.`;
    }

    await this.reboots.save(
      this.reboots.create({ userId, host, status: 'pending' }),
    );

    return '🔄 Запрос на перезагрузку роутера принят. Плата заберёт его в течение минуты; напишу сюда, когда роутер вернётся.';
  }

  // ------------------------------------------------------------------ internals

  private latestReport(): Promise<RouterReport | null> {
    return this.reports.findOne({ where: {}, order: { reportedAt: 'DESC' } });
  }

  // Closes requests nobody finished, and says so: a press that silently does nothing is the worst answer.
  private async expireStale(
    userId: number,
    host: string,
    now: Date,
  ): Promise<void> {
    const cases: [RouterRebootStatus, number, string][] = [
      [
        'pending',
        REBOOT_PENDING_MS,
        '⌛ Запрос на перезагрузку роутера не выполнен: агент на плате не забрал его за 10 минут. Роутер не трогали.',
      ],
      [
        'taken',
        REBOOT_TAKEN_MS,
        '⚠️ Агент взял запрос на перезагрузку роутера, но не сообщил, чем всё кончилось. Проверьте, вернулся ли роутер.',
      ],
    ];

    for (const [status, ttl, message] of cases) {
      const stale = await this.reboots.find({
        where: {
          userId,
          host,
          status,
          createdAt: LessThan(new Date(now.getTime() - ttl)),
        },
      });

      for (const row of stale) {
        const closed = await this.reboots.update(
          { id: row.id, status },
          { status: 'expired', finishedAt: now },
        );

        if (closed.affected === 1) await this.telegram.send(message);
      }
    }
  }
}
