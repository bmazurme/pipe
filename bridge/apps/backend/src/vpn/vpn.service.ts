import {
  BadGatewayException,
  HttpException,
  Injectable,
  Optional,
} from '@nestjs/common';

import { AppLogService } from '../logs/app-log.service';
import { GithubActionsService } from './github-actions.service';
import { OUTBOUND_FETCH_TIMEOUT_MS, isTimeoutError } from './outbound';
import { WorkerSecretName } from './dto/set-worker-secret.dto';
import { ProvisionVpnServerDto } from './dto/provision-vpn-server.dto';
import { VpnConnection } from './entities/vpn-connection.entity';
import { VpnConnectionsService } from './vpn-connections.service';

interface XrayRealitySettings {
  target: string;
  serverNames: string[];
  shortIds: string[];
  settings: {
    publicKey: string;
    fingerprint: string;
    spiderX: string;
  };
}

interface XrayInbound {
  port: number;
  clientStats?: {
    id: number;
    email: string;
    uuid: string;
    up: number;
    down: number;
    lastOnline: number;
  }[];
  settings: { clients: { id: string; flow: string }[] };
  streamSettings?: { realitySettings?: XrayRealitySettings };
}

function sniOf(reality: XrayRealitySettings): string {
  return reality.serverNames[0] ?? reality.target.split(':')[0];
}

export interface VpnStatus {
  // null when the client has never connected (a brand-new inbound, or one
  // whose stats were reset) — distinct from "connected a long time ago",
  // which the frontend renders differently.
  lastOnline: string | null;
  upBytes: number;
  downBytes: number;
  sni: string;
  fingerprint: string;
  port: number;
}

// A fresh client never connected is reported here as lastOnline: 0 by x-ui,
// not absent — zero is not a valid epoch ms value for "just connected".
const NEVER_ONLINE = 0;

// The panel is a separate server: when it cannot be reached the useful fact is *why* (refused,
// no such host, bad certificate), which Node reports on the error's `cause`, not its message.
function networkReason(error: unknown): string | null {
  const cause = (error as { cause?: { code?: string; message?: string } })
    ?.cause;

  if (cause?.code) return cause.code;
  if (error instanceof TypeError) return cause?.message ?? error.message;

  return null;
}

// How often the same failure is written to the app log: the VPN page polls every 15 s.
const FAILURE_LOG_EVERY_MS = 5 * 60_000;

const STATUS_TTL_MS = 10_000;
const STATUS_FAILURE_TTL_MS = 30_000;

interface StatusCacheEntry {
  // Connection URL + token: editing either invalidates the entry.
  signature: string;
  expiresAt: number;
  inFlight?: Promise<VpnStatus>;
  // The settled promise itself, so a cached failure rethrows the same exception.
  result?: Promise<VpnStatus>;
}

@Injectable()
export class VpnService {
  private readonly lastFailureLoggedAt = new Map<string, number>();
  private readonly statusCache = new Map<number, StatusCacheEntry>();

  constructor(
    private readonly vpnConnectionsService: VpnConnectionsService,
    private readonly githubActions: GithubActionsService,
    @Optional() private readonly appLogs?: AppLogService,
  ) {}

  // A failed status check reads as one generic line in the UI; this leaves the cause in
  // Profile → Logs. Deduplicated, since the status is polled.
  private recordStatusFailure(error: unknown): void {
    const reason =
      error instanceof HttpException ? error.message : String(error);
    const now = Date.now();

    if (
      now - (this.lastFailureLoggedAt.get(reason) ?? 0) <
      FAILURE_LOG_EVERY_MS
    ) {
      return;
    }

    this.lastFailureLoggedAt.set(reason, now);
    void this.appLogs?.record({
      level: 'warn',
      source: 'integration',
      event: 'vpn.status_failed',
      message: `VPN status check failed: ${reason}`,
    });
  }

  private async panelRequest<T>(
    connection: VpnConnection,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const panelUrl = connection.panelUrl.replace(/\/$/, '');
    let body: { success: boolean; msg?: string; obj: T };
    try {
      const response = await fetch(`${panelUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${connection.panelApiToken}`,
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
      });

      if (response.status === 401 || response.status === 403) {
        throw new BadGatewayException(
          `VPN panel "${connection.name}" rejected the API token (${response.status}) — check the token saved for this connection`,
        );
      }

      if (!response.ok) {
        throw new BadGatewayException(
          `VPN panel request failed (${response.status})`,
        );
      }

      body = (await response.json()) as typeof body;
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new BadGatewayException(
          `VPN panel "${connection.name}" did not respond within ${OUTBOUND_FETCH_TIMEOUT_MS}ms (${path})`,
        );
      }

      const reason =
        error instanceof HttpException ? null : networkReason(error);

      if (reason) {
        throw new BadGatewayException(
          `VPN panel "${connection.name}" is unreachable from bridge (${reason})`,
        );
      }

      throw error;
    }
    if (!body.success) {
      throw new BadGatewayException(
        `VPN panel reported failure: ${body.msg ?? 'unknown error'}`,
      );
    }
    return body.obj;
  }

  private async getInbound(connection: VpnConnection): Promise<XrayInbound> {
    const inbounds = await this.panelRequest<XrayInbound[]>(
      connection,
      '/panel/api/inbounds/list',
    );
    const inbound = inbounds[0];
    if (!inbound) {
      throw new BadGatewayException('VPN panel has no inbound configured');
    }
    return inbound;
  }

  // A panel whose first inbound is some other protocol has no Reality settings; reading
  // them used to throw a TypeError, which callers could only report as a generic 500.
  private realityOf(inbound: XrayInbound): XrayRealitySettings {
    const reality = inbound.streamSettings?.realitySettings;

    if (!reality) {
      throw new BadGatewayException(
        'The first inbound on the VPN panel is not a VLESS Reality inbound',
      );
    }

    return {
      ...reality,
      serverNames: reality.serverNames ?? [],
      shortIds: reality.shortIds ?? [],
    };
  }

  private async getStatusFor(connection: VpnConnection): Promise<VpnStatus> {
    const inbound = await this.getInbound(connection);
    const stats = inbound.clientStats?.[0];
    const reality = this.realityOf(inbound);

    return {
      lastOnline:
        stats && stats.lastOnline !== NEVER_ONLINE
          ? new Date(stats.lastOnline).toISOString()
          : null,
      upBytes: stats?.up ?? 0,
      downBytes: stats?.down ?? 0,
      sni: sniOf(reality),
      fingerprint: reality.settings.fingerprint,
      port: inbound.port,
    };
  }

  // Polled status checks share a short-lived per-connection result (and one in-flight request),
  // so open tabs don't each hit the panel. A failure is remembered longer than a success to
  // stop hammering a broken panel. `force` bypasses and refreshes the cache.
  private cachedStatusFor(
    connection: VpnConnection,
    force: boolean,
  ): Promise<VpnStatus> {
    const signature = `${connection.panelUrl}\n${connection.panelApiToken}`;
    const now = Date.now();
    const entry = this.statusCache.get(connection.id);

    if (!force && entry && entry.signature === signature) {
      if (entry.inFlight) return entry.inFlight;
      if (entry.expiresAt > now && entry.result) return entry.result;
    }

    const fresh: StatusCacheEntry = { signature, expiresAt: 0 };
    const request = this.getStatusFor(connection);

    fresh.inFlight = request;
    this.statusCache.set(connection.id, fresh);
    request.then(
      () => {
        delete fresh.inFlight;
        fresh.expiresAt = Date.now() + STATUS_TTL_MS;
        fresh.result = request;
      },
      () => {
        delete fresh.inFlight;
        fresh.expiresAt = Date.now() + STATUS_FAILURE_TTL_MS;
        fresh.result = request;
      },
    );

    return request;
  }

  async getStatus(): Promise<VpnStatus> {
    try {
      const active = await this.vpnConnectionsService.getActive();

      return await this.cachedStatusFor(active, false);
    } catch (error) {
      this.recordStatusFailure(error);
      throw error;
    }
  }

  // Same status call against a specific connection, active or not — backs
  // the "Проверить" button on each row of the connections list.
  async checkConnectionStatus(id: number, force = false): Promise<VpnStatus> {
    try {
      const connection = await this.vpnConnectionsService.findOne(id);

      return await this.cachedStatusFor(connection, force);
    } catch (error) {
      this.recordStatusFailure(error);
      throw error;
    }
  }

  // Rebuilds the worker's Xray client config from the active connection's
  // actual, current live settings (not whatever was last pushed) — this is
  // the exact drift (panel edited independently of the worker's config)
  // that caused real production incidents earlier, automated away.
  private async buildClientConfig(connection: VpnConnection): Promise<string> {
    const inbound = await this.getInbound(connection);
    const client = inbound.settings.clients[0];
    const reality = this.realityOf(inbound);

    if (!client) {
      throw new BadGatewayException(
        'VPN panel inbound has no client configured',
      );
    }

    const config = {
      log: { loglevel: 'warning' },
      inbounds: [{ listen: '0.0.0.0', port: 1080, protocol: 'http' }],
      outbounds: [
        {
          protocol: 'vless',
          settings: {
            vnext: [
              {
                address: connection.serverAddress,
                port: inbound.port,
                users: [
                  { id: client.id, encryption: 'none', flow: client.flow },
                ],
              },
            ],
          },
          streamSettings: {
            network: 'tcp',
            security: 'reality',
            realitySettings: {
              serverName: sniOf(reality),
              fingerprint: reality.settings.fingerprint,
              publicKey: reality.settings.publicKey,
              shortId: reality.shortIds[0],
              spiderX: reality.settings.spiderX,
            },
          },
        },
      ],
    };

    return JSON.stringify(config, null, 2);
  }

  // Pushes the worker's VPN client config built from the active connection's
  // current live state, then redeploys — the one-button fix for the
  // publicKey/SNI drift class of bug.
  async syncWorkerVpnConfig(): Promise<void> {
    const active = await this.vpnConnectionsService.getActive();
    const config = await this.buildClientConfig(active);
    await this.githubActions.setSecret('VPN_CLIENT_CONFIG', config);
    await this.githubActions.triggerDeploy();
  }

  async setWorkerSecret(name: WorkerSecretName, value: string): Promise<void> {
    await this.githubActions.setSecret(name, value);
    await this.githubActions.triggerDeploy();
  }

  // A ready vless:// Reality link for the end user's own VPN client
  // (v2rayNG, NekoBox, ...) — same inbound data buildClientConfig() reads for
  // worker's outbound, just rendered as the standard client import URI
  // instead of an Xray outbound block. Works against any stored connection,
  // not only the active one — each row in the connections list can produce
  // its own link.
  async getConnectionLink(id: number): Promise<{ link: string }> {
    const connection = await this.vpnConnectionsService.findOne(id);
    const inbound = await this.getInbound(connection);
    const client = inbound.settings.clients[0];
    const reality = this.realityOf(inbound);

    if (!client) {
      throw new BadGatewayException(
        'VPN panel inbound has no client configured',
      );
    }

    const sni = sniOf(reality);
    const params = new URLSearchParams({
      security: 'reality',
      encryption: 'none',
      pbk: reality.settings.publicKey,
      fp: reality.settings.fingerprint,
      sni,
      sid: reality.shortIds[0] ?? '',
      spx: reality.settings.spiderX,
      type: 'tcp',
      flow: client.flow,
    });

    return {
      link: `vless://${client.id}@${connection.serverAddress}:${inbound.port}?${params.toString()}#pipe-vpn`,
    };
  }

  // Provisions a brand-new VPN node from a bare IP + SSH credentials: pushes
  // them as GitHub secrets (never touches bridge's own process/logs with the
  // password) and triggers provision-vpn-server.yml, which SSHes in,
  // installs AdGuard Home + 3x-ui, and creates the initial Reality inbound.
  // See that workflow and bridge/deploy/provision-vpn-server.sh for the
  // actual install steps.
  //
  // This no longer writes VPN_PANEL_URL/VPN_PANEL_API_TOKEN/
  // VPN_SERVER_ADDRESS anywhere — those are stored connections now (see
  // VpnConnectionsService), added by hand via POST /api/v1/vpn/connections
  // once the workflow's own log prints the new panel's URL/token.
  async provisionServer(dto: ProvisionVpnServerDto): Promise<void> {
    await this.githubActions.setSecret('VPN_PROVISION_HOST', dto.host);
    await this.githubActions.setSecret('VPN_PROVISION_SSH_USER', dto.sshUser);
    await this.githubActions.setSecret(
      'VPN_PROVISION_SSH_PASSWORD',
      dto.sshPassword,
    );
    await this.githubActions.dispatchWorkflow('provision-vpn-server.yml');
  }
}
