import { assessRouter, RouterData } from './router';

const NOW = new Date('2026-11-03T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const healthy = (over: Partial<RouterData> = {}): RouterData => ({
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
  rxBps: 1_000_000,
  txBps: 200_000,
  ...over,
});

describe('assessRouter', () => {
  it('is ok when the WAN is up, the internet is there and the ping is clean', () => {
    expect(assessRouter(healthy(), minutesAgo(1), NOW)).toEqual({
      status: 'ok',
      reasons: [],
    });
  });

  it('says the agent went quiet, and trusts nothing else, once the report is stale', () => {
    const verdict = assessRouter(
      healthy({ internetOk: false }),
      minutesAgo(9),
      NOW,
    );

    expect(verdict.status).toBe('bad');
    expect(verdict.reasons).toEqual([
      'Данные о роутере не приходят 9 мин — агент на плате не работает',
    ]);
    expect(
      assessRouter(healthy(), new Date(NOW.getTime() - 2 * 3_600_000), NOW)
        .reasons[0],
    ).toContain('2 ч');
  });

  it('is bad, with the one reason, when the router does not answer ping', () => {
    expect(
      assessRouter(
        healthy({ reachable: false, sshOk: false }),
        minutesAgo(1),
        NOW,
      ),
    ).toEqual({
      status: 'bad',
      reasons: ['Роутер не отвечает на ping с платы'],
    });
  });

  it('warns that SSH does not work when the router answers ping but cannot be read', () => {
    const verdict = assessRouter(
      healthy({ sshOk: false, internetOk: null, wanState: null }),
      minutesAgo(1),
      NOW,
    );

    expect(verdict.status).toBe('warn');
    expect(verdict.reasons).toEqual([
      'Роутер отвечает, но прочитать его по SSH не удалось (ключ?)',
    ]);
  });

  it('is bad when the provider cable is out', () => {
    expect(
      assessRouter(healthy({ wanAux: 1, wanState: 0 }), minutesAgo(1), NOW)
        .reasons,
    ).toEqual(['Кабель провайдера не подключён к WAN']);
  });

  it('is bad when the WAN is not connected, and when it is connected but there is no internet', () => {
    expect(
      assessRouter(healthy({ wanState: 3 }), minutesAgo(1), NOW).reasons,
    ).toEqual(['WAN не подключён (состояние 3)']);
    expect(
      assessRouter(healthy({ internetOk: false }), minutesAgo(1), NOW),
    ).toEqual({
      status: 'bad',
      reasons: ['WAN подключён, но интернета нет'],
    });
  });

  it('judges packet loss and latency to the outside', () => {
    expect(
      assessRouter(healthy({ pingLossPct: 30 }), minutesAgo(1), NOW),
    ).toEqual({
      status: 'warn',
      reasons: ['Потеряно 30 % пакетов до внешнего адреса'],
    });
    expect(
      assessRouter(healthy({ pingLossPct: 60 }), minutesAgo(1), NOW).status,
    ).toBe('bad');
    expect(
      assessRouter(healthy({ pingMs: 240.4 }), minutesAgo(1), NOW).reasons,
    ).toEqual(['Задержка до внешнего адреса 240 мс']);
  });

  it('notes a router that has just rebooted, as a remark', () => {
    expect(
      assessRouter(healthy({ uptimeSec: 180 }), minutesAgo(1), NOW),
    ).toEqual({
      status: 'warn',
      reasons: ['Роутер перезагрузился 3 мин назад'],
    });
  });

  it('copes with readings the router did not give', () => {
    expect(
      assessRouter(
        healthy({
          uptimeSec: null,
          wanState: null,
          wanAux: null,
          internetOk: null,
          pingMs: null,
          pingLossPct: null,
        }),
        minutesAgo(1),
        NOW,
      ).status,
    ).toBe('ok');
  });
});
