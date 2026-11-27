import {
  ALERT_AFTER_FAILURES,
  ExternalHeartbeatService,
} from './external-heartbeat.service';

const URL_SECRET = 'https://hc-ping.example/ping/0b8d-secret-uuid';

function make(health: 'ok' | 'degraded' = 'ok') {
  const app = {
    getHealthStatus: jest.fn().mockResolvedValue({
      status: health,
      database: health === 'ok',
      pendingMigrations: false,
    }),
  };
  const notifier = { send: jest.fn().mockResolvedValue(true) };
  const service = new ExternalHeartbeatService(app as never, notifier as never);

  return { service, app, notifier };
}

describe('ExternalHeartbeatService', () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.EXTERNAL_HEARTBEAT_URL;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.EXTERNAL_HEARTBEAT_URL = URL_SECRET;
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as never;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.EXTERNAL_HEARTBEAT_URL;
    else process.env.EXTERNAL_HEARTBEAT_URL = originalUrl;
  });

  it('pings the watcher while bridge is healthy, and records when', async () => {
    const { service } = make();

    await service.tick(new Date('2026-11-27T10:00:00Z'));

    expect(fetchMock).toHaveBeenCalledWith(
      URL_SECRET,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(service.status()).toMatchObject({
      configured: true,
      lastOkAt: '2026-11-27T10:00:00.000Z',
      lastFailure: null,
    });
  });

  it('does nothing without an address, and never pings an address that is not https (it is a secret)', async () => {
    const { service } = make();

    delete process.env.EXTERNAL_HEARTBEAT_URL;
    await service.tick();
    process.env.EXTERNAL_HEARTBEAT_URL = 'http://hc.example/ping/x';
    await service.tick();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.status().configured).toBe(false);
  });

  it('stays SILENT when bridge is not healthy — the silence is what the watcher alarms on', async () => {
    const { service, app } = make('degraded');

    await service.tick(new Date('2026-11-27T10:00:00Z'));

    expect(app.getHealthStatus).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.status()).toMatchObject({
      lastOkAt: null,
      lastSkippedAt: '2026-11-27T10:00:00.000Z',
    });
  });

  it('records a failed ping without the secret address, and does not alarm for one miss', async () => {
    const { service, notifier } = make();

    fetchMock.mockRejectedValue(new Error(`fetch failed for ${URL_SECRET}`));
    await service.tick(new Date('2026-11-27T10:00:00Z'));

    expect(service.status().lastFailure).toBe('fetch failed for <url>');
    expect(JSON.stringify(service.status())).not.toContain('secret-uuid');
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('treats an HTTP error as a failure', async () => {
    const { service } = make();

    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    await service.tick();

    expect(service.status().lastFailure).toBe('HTTP 404');
  });

  it(`says once, after ${ALERT_AFTER_FAILURES} failures in a row, that the heartbeat does not get through — and once when it does again`, async () => {
    const { service, notifier } = make();

    fetchMock.mockRejectedValue(new Error('timeout'));
    for (let i = 0; i < ALERT_AFTER_FAILURES + 5; i++) await service.tick();

    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.send.mock.calls[0][0]).toContain(
      'не доходит 10 минут подряд',
    );
    expect(notifier.send.mock.calls[0][0]).not.toContain('secret-uuid');

    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await service.tick();
    await service.tick();

    expect(notifier.send).toHaveBeenCalledTimes(2);
    expect(notifier.send.mock.calls[1][0]).toContain('снова получает');
  });

  it('a success in between resets the count', async () => {
    const { service, notifier } = make();

    for (let i = 0; i < ALERT_AFTER_FAILURES - 1; i++) {
      fetchMock.mockRejectedValue(new Error('timeout'));
      await service.tick();
    }

    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await service.tick();
    fetchMock.mockRejectedValue(new Error('timeout'));
    await service.tick();

    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('works without a notifier', async () => {
    const app = {
      getHealthStatus: jest.fn().mockResolvedValue({ status: 'ok' }),
    };
    const service = new ExternalHeartbeatService(app as never);

    fetchMock.mockRejectedValue(new Error('x'));

    await expect(service.tick()).resolves.toBeUndefined();
  });
});
