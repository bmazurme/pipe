import { HttpException, Injectable, Logger, Optional } from '@nestjs/common';

import { AppLogService } from '../logs/app-log.service';
import { NotifyService } from '../telegram/notify.service';
import { VpnConnection } from './entities/vpn-connection.entity';
import { VpnConnectionsService } from './vpn-connections.service';

// How often the same failure is written to the app log: the VPN page polls every 15 s.
const FAILURE_LOG_EVERY_MS = 5 * 60_000;

// Once a failure has been alerted, VPN_ALERTS=off keeps the owner from being paged again until
// the panel recovers — set when the alert is unwanted, e.g. during known maintenance.
const VPN_ALERTS_OFF = () =>
  (process.env.VPN_ALERTS ?? '').toLowerCase() === 'off';

@Injectable()
export class VpnStatusAlertsService {
  private readonly logger = new Logger(VpnStatusAlertsService.name);
  private readonly lastFailureLoggedAt = new Map<string, number>();

  constructor(
    private readonly vpnConnectionsService: VpnConnectionsService,
    @Optional() private readonly appLogs?: AppLogService,
    @Optional() private readonly notifier?: NotifyService,
  ) {}

  // A failed status check reads as one generic line in the UI; this leaves the cause in
  // Profile → Logs (deduplicated, since the status is polled) and, independently, pages the
  // owner on Telegram the first time — not on every subsequent failing poll, via
  // connection.failureAlertedAt (cleared by recordRecovered once it responds again).
  recordFailure(connection: VpnConnection | undefined, error: unknown): void {
    const reason =
      error instanceof HttpException ? error.message : String(error);
    const now = Date.now();

    if (
      now - (this.lastFailureLoggedAt.get(reason) ?? 0) >=
      FAILURE_LOG_EVERY_MS
    ) {
      this.lastFailureLoggedAt.set(reason, now);
      void this.appLogs?.record({
        level: 'warn',
        source: 'integration',
        event: 'vpn.status_failed',
        message: `VPN status check failed: ${reason}`,
      });
    }

    if (connection && !connection.failureAlertedAt) {
      void this.alertFailure(connection, reason);
    }
  }

  recordRecovered(connection: VpnConnection): void {
    if (connection.failureAlertedAt) {
      void this.notifyRecovered(connection);
    }
  }

  private async alertFailure(
    connection: VpnConnection,
    reason: string,
  ): Promise<void> {
    try {
      // Saved first: if sending fails the owner misses one message, but a failing
      // Telegram channel can't turn into a repeat alert on every subsequent poll.
      // Conditional claim: concurrent polls hold the same stale entity, only the winner sends.
      const claimed = await this.vpnConnectionsService.claimFailureAlert(
        connection.id,
      );
      if (!claimed || VPN_ALERTS_OFF()) return;

      // Urgent: worker traffic goes through it, and it is not the kind of news that waits for the morning digest.
      await this.notifier?.send(
        `🔌 VPN «${connection.name}» не отвечает: ${reason}`,
        { urgent: true },
      );
    } catch (err) {
      this.logger.warn(
        `VPN failure alert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async notifyRecovered(connection: VpnConnection): Promise<void> {
    try {
      const claimed = await this.vpnConnectionsService.claimRecovery(
        connection.id,
      );
      if (!claimed || VPN_ALERTS_OFF()) return;

      await this.notifier?.send(`✅ VPN «${connection.name}» снова отвечает`);
    } catch (err) {
      this.logger.warn(
        `VPN recovery alert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
