import { BadGatewayException } from '@nestjs/common';

import { AppLogService } from '../logs/app-log.service';
import { NotifyService } from '../telegram/notify.service';
import { VpnConnection } from './entities/vpn-connection.entity';
import { VpnConnectionsService } from './vpn-connections.service';
import { VpnStatusAlertsService } from './vpn-status-alerts.service';

function setup() {
  const connection = {
    id: 1,
    name: 'primary',
    failureAlertedAt: null,
  } as VpnConnection;
  const connections = {
    claimFailureAlert: jest.fn(async () => {
      connection.failureAlertedAt = new Date();
      return true;
    }),
    claimRecovery: jest.fn(async () => {
      connection.failureAlertedAt = null;
      return true;
    }),
  };
  const appLogs = { record: jest.fn() };
  const notifier = { send: jest.fn(async () => true) };
  const alerts = new VpnStatusAlertsService(
    connections as unknown as VpnConnectionsService,
    appLogs as unknown as AppLogService,
    notifier as unknown as NotifyService,
  );

  return { alerts, connection, connections, appLogs, notifier };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const failure = () => new BadGatewayException('panel down');

describe('VpnStatusAlertsService', () => {
  const originalEnv = process.env.VPN_ALERTS;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    delete process.env.VPN_ALERTS;
  });

  afterEach(() => {
    jest.useRealTimers();
    if (originalEnv === undefined) delete process.env.VPN_ALERTS;
    else process.env.VPN_ALERTS = originalEnv;
  });

  it('logs the same reason once per 5 minutes', () => {
    const { alerts, appLogs } = setup();

    for (let i = 0; i < 3; i++) alerts.recordFailure(undefined, failure());
    expect(appLogs.record).toHaveBeenCalledTimes(1);
    expect(appLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        source: 'integration',
        event: 'vpn.status_failed',
        message: 'VPN status check failed: panel down',
      }),
    );

    jest.advanceTimersByTime(5 * 60_000 + 1);
    alerts.recordFailure(undefined, failure());
    expect(appLogs.record).toHaveBeenCalledTimes(2);
  });

  it('logs a different reason separately', () => {
    const { alerts, appLogs } = setup();

    alerts.recordFailure(undefined, failure());
    alerts.recordFailure(undefined, new BadGatewayException('other'));

    expect(appLogs.record).toHaveBeenCalledTimes(2);
  });

  it('pages once per failure until recovery', async () => {
    const { alerts, connection, notifier } = setup();

    for (let i = 0; i < 3; i++) {
      alerts.recordFailure(connection, failure());
      await flush();
    }

    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledWith(
      '🔌 VPN «primary» не отвечает: panel down',
      { urgent: true },
    );
  });

  it('sends the recovery message and clears the dedupe state', async () => {
    const { alerts, connection, connections, notifier } = setup();

    alerts.recordFailure(connection, failure());
    await flush();
    alerts.recordRecovered(connection);
    await flush();

    expect(connections.claimRecovery).toHaveBeenCalledWith(1);
    expect(notifier.send).toHaveBeenLastCalledWith(
      '✅ VPN «primary» снова отвечает',
    );
    expect(connection.failureAlertedAt).toBeNull();
  });

  it('says nothing on recovery when no failure was alerted', async () => {
    const { alerts, connection, notifier } = setup();

    alerts.recordRecovered(connection);
    await flush();

    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('does not send with VPN_ALERTS=off, but still marks and clears the state', async () => {
    process.env.VPN_ALERTS = 'off';
    const { alerts, connection, notifier } = setup();

    alerts.recordFailure(connection, failure());
    await flush();
    expect(connection.failureAlertedAt).not.toBeNull();

    alerts.recordRecovered(connection);
    await flush();
    expect(connection.failureAlertedAt).toBeNull();
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('swallows a failing notifier.send', async () => {
    const { alerts, connection, notifier } = setup();
    notifier.send.mockRejectedValueOnce(new Error('telegram down'));

    expect(() => alerts.recordFailure(connection, failure())).not.toThrow();
    await flush();

    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('pages once when concurrent polls both hold a stale entity', async () => {
    const { alerts, connection, connections, notifier } = setup();
    connections.claimFailureAlert
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const stale = { ...connection } as VpnConnection;

    alerts.recordFailure(connection, failure());
    alerts.recordFailure(stale, failure());
    await flush();

    expect(connections.claimFailureAlert).toHaveBeenCalledTimes(2);
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('sends the recovery message once when concurrent polls both hold a stale entity', async () => {
    const { alerts, connection, connections, notifier } = setup();
    connection.failureAlertedAt = new Date();
    connections.claimRecovery
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const stale = { ...connection } as VpnConnection;

    alerts.recordRecovered(connection);
    alerts.recordRecovered(stale);
    await flush();

    expect(connections.claimRecovery).toHaveBeenCalledTimes(2);
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });
});
