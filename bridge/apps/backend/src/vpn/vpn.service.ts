import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { encryptSecretForGitHub } from './github-secrets.util';
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
  streamSettings: { realitySettings: XrayRealitySettings };
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

@Injectable()
export class VpnService {
  constructor(
    private readonly configService: ConfigService,
    private readonly vpnConnectionsService: VpnConnectionsService,
  ) {}

  private required(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new InternalServerErrorException(
        `${key} is not configured on bridge's backend`,
      );
    }
    return value;
  }

  private async panelRequest<T>(
    connection: VpnConnection,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const panelUrl = connection.panelUrl.replace(/\/$/, '');
    const response = await fetch(`${panelUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${connection.panelApiToken}`,
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new BadGatewayException(
        `VPN panel request failed (${response.status})`,
      );
    }

    const body = (await response.json()) as {
      success: boolean;
      msg?: string;
      obj: T;
    };
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

  private async getStatusFor(connection: VpnConnection): Promise<VpnStatus> {
    const inbound = await this.getInbound(connection);
    const stats = inbound.clientStats?.[0];
    const reality = inbound.streamSettings.realitySettings;

    return {
      lastOnline:
        stats && stats.lastOnline !== NEVER_ONLINE
          ? new Date(stats.lastOnline).toISOString()
          : null,
      upBytes: stats?.up ?? 0,
      downBytes: stats?.down ?? 0,
      sni: reality.serverNames[0] ?? reality.target.split(':')[0],
      fingerprint: reality.settings.fingerprint,
      port: inbound.port,
    };
  }

  async getStatus(): Promise<VpnStatus> {
    const active = await this.vpnConnectionsService.getActive();
    return this.getStatusFor(active);
  }

  // Same status call against a specific connection, active or not — backs
  // the "Проверить" button on each row of the connections list.
  async checkConnectionStatus(id: number): Promise<VpnStatus> {
    const connection = await this.vpnConnectionsService.findOne(id);
    return this.getStatusFor(connection);
  }

  // Rebuilds the worker's Xray client config from the active connection's
  // actual, current live settings (not whatever was last pushed) — this is
  // the exact drift (panel edited independently of the worker's config)
  // that caused real production incidents earlier, automated away.
  private async buildClientConfig(connection: VpnConnection): Promise<string> {
    const inbound = await this.getInbound(connection);
    const client = inbound.settings.clients[0];
    const reality = inbound.streamSettings.realitySettings;

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
              serverName:
                reality.serverNames[0] ?? reality.target.split(':')[0],
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

  private githubRepo(): string {
    return this.required('GITHUB_REPO');
  }

  private async githubRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(
      `https://api.github.com/repos/${this.githubRepo()}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.required('GITHUB_TOKEN')}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init?.headers ?? {}),
        },
      },
    );

    if (!response.ok) {
      throw new BadGatewayException(
        `GitHub API request failed (${response.status}): ${await response.text()}`,
      );
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // GitHub Actions secrets are write-only (sealed-box encrypted client-side,
  // no corresponding read endpoint) — see github-secrets.util.ts.
  private async setGithubSecret(name: string, value: string): Promise<void> {
    const { key, key_id: keyId } = await this.githubRequest<{
      key: string;
      key_id: string;
    }>('/actions/secrets/public-key');
    const encryptedValue = await encryptSecretForGitHub(key, value);

    await this.githubRequest(`/actions/secrets/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyId }),
    });
  }

  private async triggerWorkflow(workflowFile: string): Promise<void> {
    await this.githubRequest(`/actions/workflows/${workflowFile}/dispatches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
  }

  private async triggerDeploy(): Promise<void> {
    const workflowFile =
      this.configService.get<string>('GITHUB_DEPLOY_WORKFLOW') ??
      'deploy-bridge.yml';
    await this.triggerWorkflow(workflowFile);
  }

  // Pushes the worker's VPN client config built from the active connection's
  // current live state, then redeploys — the one-button fix for the
  // publicKey/SNI drift class of bug.
  async syncWorkerVpnConfig(): Promise<void> {
    const active = await this.vpnConnectionsService.getActive();
    const config = await this.buildClientConfig(active);
    await this.setGithubSecret('VPN_CLIENT_CONFIG', config);
    await this.triggerDeploy();
  }

  async setWorkerSecret(name: WorkerSecretName, value: string): Promise<void> {
    await this.setGithubSecret(name, value);
    await this.triggerDeploy();
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
    const reality = inbound.streamSettings.realitySettings;

    if (!client) {
      throw new BadGatewayException(
        'VPN panel inbound has no client configured',
      );
    }

    const sni = reality.serverNames[0] ?? reality.target.split(':')[0];
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
    await this.setGithubSecret('VPN_PROVISION_HOST', dto.host);
    await this.setGithubSecret('VPN_PROVISION_SSH_USER', dto.sshUser);
    await this.setGithubSecret('VPN_PROVISION_SSH_PASSWORD', dto.sshPassword);
    await this.triggerWorkflow('provision-vpn-server.yml');
  }
}
