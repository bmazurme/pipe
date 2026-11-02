import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RouterRebootResultDto, RouterReportDto } from './dto/router.dto';
import { RouterService } from './router.service';

const NOW = new Date('2026-11-03T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const report = (over: object = {}) => ({
  host: 'asus',
  reachable: true,
  sshOk: true,
  uptimeSec: 400_000,
  wanState: 2,
  wanAux: 0,
  internetOk: true,
  wanIp: '89.207.218.46',
  pingMs: 12,
  pingLossPct: 0,
  ...over,
});

function setup(
  opts: {
    latest?: unknown;
    pending?: unknown;
    active?: unknown;
    last?: unknown;
    stale?: unknown[];
  } = {},
) {
  const reports = {
    upsert: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue(opts.latest ?? null),
    find: jest.fn().mockResolvedValue([]),
  };
  const reboots = {
    // record() asks for the pending one; requestFromTelegram() for an active one, then for the last
    findOne: jest.fn(async (arg: { where: { status?: unknown } }) => {
      if (arg.where.status === 'pending') return opts.pending ?? null;
      if (arg.where.status) return opts.active ?? null;

      return opts.last ?? null;
    }),
    find: jest.fn().mockResolvedValue(opts.stale ?? []),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    save: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((x: object) => x),
  };
  const telegram = { send: jest.fn().mockResolvedValue(true) };

  return {
    service: new RouterService(
      reports as never,
      reboots as never,
      telegram as never,
    ),
    reports,
    reboots,
    telegram,
  };
}

describe('RouterService.record', () => {
  it('keeps the latest report per account and router (an upsert on the pair)', async () => {
    const { service, reports } = setup();

    await service.record(7, report() as never, NOW);

    expect(reports.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        host: 'asus',
        reportedAt: NOW,
        data: expect.objectContaining({ wanIp: '89.207.218.46' }),
      }),
      ['userId', 'host'],
    );
  });

  it('hands out nothing when nobody asked for a reboot', async () => {
    const { service } = setup();

    await expect(service.record(7, report() as never, NOW)).resolves.toEqual({
      rebootRequestId: null,
    });
  });

  it('hands out the waiting request once: it is taken with a compare-and-set on its status', async () => {
    const { service, reboots } = setup({ pending: { id: 5 } });

    await expect(service.record(7, report() as never, NOW)).resolves.toEqual({
      rebootRequestId: 5,
    });
    expect(reboots.update).toHaveBeenCalledWith(
      { id: 5, status: 'pending' },
      { status: 'taken', takenAt: NOW },
    );

    reboots.update.mockResolvedValueOnce({ affected: 0 });
    await expect(service.record(7, report() as never, NOW)).resolves.toEqual({
      rebootRequestId: null,
    });
  });

  it('keeps the request for the agent when it cannot log in to the router', async () => {
    const { service, reboots } = setup({ pending: { id: 5 } });

    await expect(
      service.record(7, report({ sshOk: false }) as never, NOW),
    ).resolves.toEqual({ rebootRequestId: null });
    expect(reboots.update).not.toHaveBeenCalled();
  });

  it('closes a request nobody took in time, and says so', async () => {
    const { service, reboots, telegram } = setup({
      stale: [{ id: 3 }],
    });

    await service.record(7, report() as never, NOW);

    expect(reboots.update).toHaveBeenCalledWith(
      { id: 3, status: 'pending' },
      { status: 'expired', finishedAt: NOW },
    );
    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('не забрал'),
    );
  });
});

describe('RouterService.finish', () => {
  it('records the verdict and tells the owner', async () => {
    const { service, reboots, telegram } = setup();

    await service.finish(
      7,
      5,
      { ok: true, detail: 'вернулся через 74 с' },
      NOW,
    );

    expect(reboots.update).toHaveBeenCalledWith(
      { id: 5, userId: 7, status: 'taken' },
      { status: 'done', finishedAt: NOW, result: 'вернулся через 74 с' },
    );
    expect(telegram.send).toHaveBeenCalledWith(
      '✅ Роутер перезагружен: вернулся через 74 с',
    );
  });

  it('tells about a failure', async () => {
    const { service, telegram } = setup();

    await service.finish(
      7,
      5,
      { ok: false, detail: 'не вернулся за 5 мин' },
      NOW,
    );

    expect(telegram.send).toHaveBeenCalledWith(
      '⚠️ Перезагрузить роутер не удалось: не вернулся за 5 мин',
    );
  });

  it("refuses a request that is unknown, someone else's or already closed", async () => {
    const { service, reboots, telegram } = setup();

    reboots.update.mockResolvedValueOnce({ affected: 0 });

    await expect(
      service.finish(7, 99, { ok: true }, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(telegram.send).not.toHaveBeenCalled();
  });
});

describe('RouterService.requestFromTelegram', () => {
  const latest = (over: object = {}, ageMin = 1) => ({
    userId: 7,
    host: 'asus',
    reportedAt: minutesAgo(ageMin),
    data: report(over),
  });

  it('asks for a reboot when the router answers, can be read and nothing is under way', async () => {
    const { service, reboots } = setup({ latest: latest() });

    const text = await service.requestFromTelegram(NOW);

    expect(reboots.save).toHaveBeenCalledWith({
      userId: 7,
      host: 'asus',
      status: 'pending',
    });
    expect(text).toContain('Запрос на перезагрузку роутера принят');
  });

  it.each([
    ['there is no report at all', undefined, 'не настроен'],
    ['the report is stale', latest({}, 20), 'устарели (20 мин)'],
    [
      'the router does not answer ping',
      latest({ reachable: false, sshOk: false }),
      'не отвечает на ping',
    ],
    ['SSH does not work', latest({ sshOk: false }), 'по SSH'],
  ])('does not ask when %s, and says why', async (_name, row, expected) => {
    const { service, reboots } = setup({ latest: row });

    const text = await service.requestFromTelegram(NOW);

    expect(text).toContain(expected);
    expect(text).toContain('не запрошена');
    expect(reboots.save).not.toHaveBeenCalled();
  });

  it('does not ask twice while one is under way', async () => {
    const { service, reboots } = setup({
      latest: latest(),
      active: { id: 1, status: 'taken' },
    });

    expect(await service.requestFromTelegram(NOW)).toContain('уже запрошена');
    expect(reboots.save).not.toHaveBeenCalled();
  });

  it('does not ask again right after the previous one, and says how long to wait', async () => {
    const { service, reboots } = setup({
      latest: latest(),
      last: { id: 1, createdAt: minutesAgo(2) },
    });

    expect(await service.requestFromTelegram(NOW)).toContain(
      'примерно через 3 мин',
    );
    expect(reboots.save).not.toHaveBeenCalled();
  });
});

describe('RouterService.statusText and list', () => {
  it('writes the state, the reasons and the facts', async () => {
    const { service } = setup({
      latest: {
        userId: 7,
        host: 'asus',
        reportedAt: minutesAgo(2),
        data: report({ internetOk: false, pingMs: 31.6, uptimeSec: 7380 }),
      },
    });

    const text = await service.statusText(NOW);

    expect(text).toContain('🛑 Роутер asus: проблема');
    expect(text).toContain('• WAN подключён, но интернета нет');
    expect(text).toContain(
      'внешний адрес 89.207.218.46 · пинг 32 мс · работает 2 ч 3 мин',
    );
    expect(text).toContain('Отчёт 2 мин назад.');
  });

  it('says so when the agent has never reported', async () => {
    const { service } = setup();

    expect(await service.statusText(NOW)).toContain('ни разу не отчитывался');
  });

  it('lists the routers with the verdict and the newest reboot', async () => {
    const { service, reports, reboots } = setup();

    reports.find.mockResolvedValue([
      { host: 'asus', reportedAt: minutesAgo(1), data: report() },
    ]);
    reboots.findOne.mockResolvedValue({
      status: 'done',
      createdAt: minutesAgo(30),
      finishedAt: minutesAgo(28),
      result: 'вернулся через 74 с',
    });

    const [view] = await service.list(7, NOW);

    expect(reports.find).toHaveBeenCalledWith({
      where: { userId: 7 },
      order: { host: 'ASC' },
    });
    expect(view).toMatchObject({
      host: 'asus',
      status: 'ok',
      reboot: {
        status: 'done',
        at: minutesAgo(28).toISOString(),
        result: 'вернулся через 74 с',
      },
    });
  });
});

describe('router DTOs', () => {
  const check = (cls: new () => object, body: object) =>
    validate(plainToInstance(cls, body));

  it('accepts what the agent sends, including nulls for readings the router did not give', async () => {
    expect(await check(RouterReportDto, report())).toHaveLength(0);
    expect(
      await check(RouterReportDto, {
        host: 'asus',
        reachable: false,
        sshOk: false,
      }),
    ).toHaveLength(0);
    expect(
      await check(
        RouterReportDto,
        report({ uptimeSec: null, wanIp: null, pingMs: null, rxBps: null }),
      ),
    ).toHaveLength(0);
  });

  it('rejects a body that is not a report, a bad name and out-of-range readings', async () => {
    expect((await check(RouterReportDto, {})).length).toBeGreaterThan(0);
    expect(
      (await check(RouterReportDto, report({ host: '../x' }))).length,
    ).toBeGreaterThan(0);
    expect(
      (await check(RouterReportDto, report({ pingLossPct: 120 }))).length,
    ).toBeGreaterThan(0);
    expect(
      (await check(RouterReportDto, report({ reachable: 'yes' }))).length,
    ).toBeGreaterThan(0);
  });

  it('accepts a result with or without a detail, and rejects one without a verdict', async () => {
    expect(await check(RouterRebootResultDto, { ok: true })).toHaveLength(0);
    expect(
      await check(RouterRebootResultDto, { ok: false, detail: 'x' }),
    ).toHaveLength(0);
    expect((await check(RouterRebootResultDto, {})).length).toBeGreaterThan(0);
  });
});
