import { desiredAlerts } from './links-alerts';
import {
  assessChannels,
  Channel,
  DROP_AFTER_MS,
  ProbeResult,
  ProbeRow,
  STALE_AFTER_MS,
} from './links';

const NOW = new Date('2026-11-11T12:00:00Z');
const fresh = new Date(NOW.getTime() - 30_000);

const server: Channel = {
  key: '203.0.113.1:443',
  name: 'main',
  host: '203.0.113.1',
  port: 443,
  sni: 'example.com',
};
const probe = (
  vantage: string,
  key: string,
  result: ProbeResult = 'ok',
  over: Partial<ProbeRow> = {},
): ProbeRow => ({
  vantage,
  channelKey: key,
  result,
  tcpMs: result === 'ok' ? 300 : null,
  tlsMs: null,
  detail: null,
  probedAt: fresh,
  changedAt: new Date('2026-11-11T10:00:00Z'),
  ...over,
});

describe('assessChannels: through the tunnel', () => {
  it('has no end-to-end rows until a worker has reported', () => {
    const view = assessChannels([server], [probe('bridge', server.key)], NOW);

    expect(view.e2e).toEqual([]);
    expect(view.e2eVantages).toEqual([]);
  });

  it('makes a row per target a worker reported on, named in words, with a column per worker', () => {
    const view = assessChannels(
      [server],
      [
        probe('bridge', server.key),
        probe('worker:pi-red', 'e2e:claude'),
        probe('worker:pi-blue', 'e2e:claude'),
        probe('worker:pi-red', 'e2e:telegram'),
      ],
      NOW,
    );

    expect(
      view.e2e.map((row) => [row.key, row.name, row.host, row.state]),
    ).toEqual([
      ['e2e:claude', 'Claude API', 'api.anthropic.com', 'ok'],
      ['e2e:telegram', 'Telegram API', 'api.telegram.org', 'ok'],
    ]);
    expect(view.e2eVantages.map((v) => v.name)).toEqual([
      'worker:pi-blue',
      'worker:pi-red',
    ]);
    expect(view.status).toBe('ok');
  });

  it('keeps the workers out of the server matrix: its columns are the places that probe servers', () => {
    const view = assessChannels(
      [server],
      [probe('bridge', server.key), probe('worker:pi-red', 'e2e:claude')],
      NOW,
    );

    expect(view.vantages.map((v) => v.name)).toEqual(['bridge']);
    expect(view.channels[0].cells.map((c) => c.vantage)).toEqual(['bridge']);
  });

  it('is a PROBLEM when the Claude API is not reachable through the tunnel of any worker — nothing can be run', () => {
    const view = assessChannels(
      [server],
      [
        probe('bridge', server.key),
        probe('worker:pi-red', 'e2e:claude', 'error', { detail: 'HTTP 403' }),
        probe('worker:pi-blue', 'e2e:claude', 'tls_timeout'),
      ],
      NOW,
    );

    expect(view.e2e[0].state).toBe('down');
    expect(view.status).toBe('bad');
    expect(view.reasons).toEqual([
      'Через туннель Claude API: не проходит ни у одного воркера: запрос завис (тротлинг?); ошибка запроса (HTTP 403)',
    ]);
  });

  it('is only a remark for another target, or when some workers still get through', () => {
    const noTelegram = assessChannels(
      [server],
      [
        probe('bridge', server.key),
        probe('worker:pi-red', 'e2e:telegram', 'tls_timeout'),
      ],
      NOW,
    );
    const oneWorker = assessChannels(
      [server],
      [
        probe('bridge', server.key),
        probe('worker:pi-red', 'e2e:claude', 'tcp_refused'),
        probe('worker:pi-blue', 'e2e:claude'),
      ],
      NOW,
    );

    expect(noTelegram.status).toBe('warn');
    expect(oneWorker.e2e[0].state).toBe('partial');
    expect(oneWorker.status).toBe('warn');
    expect(oneWorker.reasons[0]).toBe(
      'Через туннель Claude API: не доходит из: worker:pi-red — туннель не принимает соединения',
    );
  });

  it('does not count a worker that stopped reporting as a failure, and shows its cell as stale', () => {
    const old = new Date(NOW.getTime() - STALE_AFTER_MS - 60_000);
    const view = assessChannels(
      [server],
      [
        probe('bridge', server.key),
        probe('worker:pi-red', 'e2e:claude'),
        probe('worker:pi-blue', 'e2e:claude', 'tls_timeout', { probedAt: old }),
      ],
      NOW,
    );

    expect(view.e2e[0].state).toBe('ok');
    expect(
      view.e2e[0].cells.find((c) => c.vantage === 'worker:pi-blue')?.stale,
    ).toBe(true);
    expect(view.status).toBe('ok');
  });

  it('forgets a worker that has been silent for a day', () => {
    const gone = new Date(NOW.getTime() - DROP_AFTER_MS - 60_000);
    const view = assessChannels(
      [server],
      [
        probe('bridge', server.key),
        probe('worker:old', 'e2e:claude', 'tls_timeout', { probedAt: gone }),
      ],
      NOW,
    );

    expect(view.e2e).toEqual([]);
    expect(view.status).toBe('ok');
  });

  it('does not let an end-to-end key count as a channel or as the pool', () => {
    const view = assessChannels(
      [server],
      [probe('worker:pi-red', 'e2e:claude')],
      NOW,
    );

    expect(view.channels[0].state).toBe('unknown');
    expect(view.status).toBe('warn');
    expect(view.reasons).toEqual([
      'Нет свежих проб каналов — проверка не запущена или не присылает данные',
    ]);
  });
});

describe('desiredAlerts: through the tunnel', () => {
  const view = (rows: ProbeRow[]) =>
    assessChannels([server], [probe('bridge', server.key), ...rows], NOW);

  it('is urgent when the Claude API is down from every worker, and says what and where', () => {
    const [alert] = desiredAlerts(
      view([
        probe('worker:pi-red', 'e2e:claude', 'tls_timeout', {
          detail: 'timeout',
        }),
      ]),
    );

    expect(alert).toMatchObject({
      key: 'e2e:e2e:claude',
      urgent: true,
      recovered: '✅ Через VPN-туннель Claude API снова проходит',
    });
    expect(alert.text).toBe(
      '🔌 Через VPN-туннель Claude API: не проходит ни у одного воркера: запрос завис (тротлинг?) (timeout)',
    );
  });

  it('is not urgent for another target, or for a partial failure', () => {
    expect(
      desiredAlerts(
        view([probe('worker:pi-red', 'e2e:telegram', 'tls_timeout')]),
      )[0].urgent,
    ).toBe(false);
    expect(
      desiredAlerts(
        view([
          probe('worker:pi-red', 'e2e:claude', 'tls_timeout'),
          probe('worker:pi-blue', 'e2e:claude'),
        ]),
      )[0].urgent,
    ).toBe(false);
  });

  it('has nothing to say while requests go through', () => {
    expect(
      desiredAlerts(
        view([
          probe('worker:pi-red', 'e2e:claude'),
          probe('worker:pi-red', 'e2e:telegram'),
        ]),
      ),
    ).toEqual([]);
  });
});
