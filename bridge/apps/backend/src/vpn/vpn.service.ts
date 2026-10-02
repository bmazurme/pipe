import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { encryptSecretForGitHub } from './github-secrets.util';
import { WorkerSecretName } from './dto/set-worker-secret.dto';
import { ProvisionVpnServerDto } from './dto/provision-vpn-server.dto';
import { ClaudeOauthCredential } from './entities/claude-oauth-credential.entity';

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

// Anthropic's OAuth token endpoint and the public client id Claude Code's own
// CLI uses against it — reverse-engineered (e.g. stencila/stencila's
// rust/auth/src/claude_code.rs), not documented by Anthropic. The client id
// identifies the client application, not a user or account, so it's fine to
// keep in source rather than as a secret.
const CLAUDE_OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

// Refresh this far ahead of the recorded expiry, not exactly at it — avoids a
// request landing in the last second of validity and getting rejected by
// clock skew between bridge and Anthropic.
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;

interface ClaudeUsageWindow {
  utilization: number;
  resets_at: string;
}

interface ClaudeUsageApiResponse {
  five_hour: ClaudeUsageWindow;
  seven_day: ClaudeUsageWindow;
  seven_day_sonnet?: ClaudeUsageWindow;
}

export interface ClaudeUsage {
  sessionPercent: number;
  sessionResetsAt: string;
  weekPercent: number;
  weekResetsAt: string;
  weekSonnetPercent: number | null;
}

@Injectable()
export class VpnService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(ClaudeOauthCredential)
    private readonly claudeCredRepo: Repository<ClaudeOauthCredential>,
  ) {}

  private panelUrl(): string {
    return this.required('VPN_PANEL_URL').replace(/\/$/, '');
  }

  private required(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new InternalServerErrorException(
        `${key} is not configured on bridge's backend`,
      );
    }
    return value;
  }

  private async panelRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.panelUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.required('VPN_PANEL_API_TOKEN')}`,
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

  private async getInbound(): Promise<XrayInbound> {
    const inbounds = await this.panelRequest<XrayInbound[]>(
      '/panel/api/inbounds/list',
    );
    const inbound = inbounds[0];
    if (!inbound) {
      throw new BadGatewayException('VPN panel has no inbound configured');
    }
    return inbound;
  }

  async getStatus(): Promise<VpnStatus> {
    const inbound = await this.getInbound();
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

  // Rebuilds the worker's Xray client config from the VPN server's actual,
  // current live settings (not whatever was last pushed) — this is the
  // exact drift (panel edited independently of the worker's config) that
  // caused real production incidents earlier, automated away.
  private async buildClientConfig(): Promise<string> {
    const inbound = await this.getInbound();
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
                address: this.required('VPN_SERVER_ADDRESS'),
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

  // Pushes the worker's VPN client config built from the VPN server's
  // current live state, then redeploys — the one-button fix for the
  // publicKey/SNI drift class of bug.
  async syncWorkerVpnConfig(): Promise<void> {
    const config = await this.buildClientConfig();
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
  // instead of an Xray outbound block.
  async getConnectionLink(): Promise<{ link: string }> {
    const inbound = await this.getInbound();
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

    const host = this.required('VPN_SERVER_ADDRESS');
    return {
      link: `vless://${client.id}@${host}:${inbound.port}?${params.toString()}#pipe-vpn`,
    };
  }

  // Provisions a brand-new VPN node from a bare IP + SSH credentials: pushes
  // them as GitHub secrets (never touches bridge's own process/logs with the
  // password) and triggers provision-vpn-server.yml, which SSHes in,
  // installs AdGuard Home + 3x-ui, creates the initial Reality inbound, and
  // — on success — pushes VPN_PANEL_URL/VPN_PANEL_API_TOKEN/
  // VPN_SERVER_ADDRESS itself and redeploys bridge. See that workflow and
  // bridge/deploy/provision-vpn-server.sh for the actual install steps.
  //
  // Worker's own VPN_CLIENT_CONFIG is NOT pushed as part of this — once
  // bridge's redeploy lands, use the existing "Синхронизировать настройки"
  // action to roll the new server's settings out to worker.
  async provisionServer(dto: ProvisionVpnServerDto): Promise<void> {
    await this.setGithubSecret('VPN_PROVISION_HOST', dto.host);
    await this.setGithubSecret('VPN_PROVISION_SSH_USER', dto.sshUser);
    await this.setGithubSecret('VPN_PROVISION_SSH_PASSWORD', dto.sshPassword);
    await this.triggerWorkflow('provision-vpn-server.yml');
  }

  // Exchanges the credential's refresh token for a fresh access token —
  // Anthropic rotates the refresh token on every call, so the new one must
  // be persisted too or the next refresh would replay an already-invalidated
  // token. Called both to mint the very first access token when a refresh
  // token is first set, and to renew an expiring one thereafter.
  private async refreshClaudeCredential(
    cred: ClaudeOauthCredential,
  ): Promise<string> {
    const response = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: CLAUDE_OAUTH_CLIENT_ID,
        refresh_token: cred.refreshToken,
      }),
    });

    if (!response.ok) {
      throw new BadGatewayException(
        `Claude OAuth token refresh failed (${response.status}) — re-seed ` +
          'credentials via POST /api/v1/vpn/claude-oauth-credential',
      );
    }

    const body = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    cred.accessToken = body.access_token;
    cred.refreshToken = body.refresh_token;
    cred.expiresAt = new Date(Date.now() + body.expires_in * 1000);
    await this.claudeCredRepo.save(cred);

    return cred.accessToken;
  }

  // Singleton row — bridge holds credentials for exactly one Claude account.
  private async findClaudeCredential(): Promise<ClaudeOauthCredential | null> {
    const [cred] = await this.claudeCredRepo.find({ take: 1 });
    return cred ?? null;
  }

  private async getValidClaudeAccessToken(): Promise<string> {
    const cred = await this.findClaudeCredential();
    if (!cred) {
      throw new InternalServerErrorException(
        'Claude OAuth credentials are not configured — set them via ' +
          'POST /api/v1/vpn/claude-oauth-credential',
      );
    }

    if (cred.expiresAt.getTime() - TOKEN_EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
      return cred.accessToken;
    }

    return this.refreshClaudeCredential(cred);
  }

  // Bootstraps (or rotates) bridge's Claude OAuth credential from a single
  // refresh token — the only value the admin ever has to copy out of
  // ~/.claude/.credentials.json's claudeAiOauth.refreshToken. Immediately
  // exchanges it for a real access token so a bad/expired token is rejected
  // here rather than silently stored and failing later.
  async setClaudeOauthCredential(refreshToken: string): Promise<void> {
    const existing = await this.findClaudeCredential();
    const cred =
      existing ??
      this.claudeCredRepo.create({
        accessToken: '',
        refreshToken: '',
        expiresAt: new Date(0),
      });
    cred.refreshToken = refreshToken;
    await this.refreshClaudeCredential(cred);
  }

  // https://api.anthropic.com/api/oauth/usage is not an officially
  // documented Anthropic endpoint — reverse-engineered by the Claude Code
  // community (see e.g. github.com/ohugonnot/claude-code-statusline) from
  // what the CLI's own /usage command calls. It could change or disappear
  // without notice; this degrades to a BadGatewayException if it does,
  // same as any other upstream failure here.
  //
  // Unlike the rest of this service, this needs a short-lived session access
  // token (the same kind the `claude` CLI itself holds and refreshes locally)
  // — a long-lived API-key-style secret doesn't work against this specific
  // endpoint, hence the self-refreshing credential above instead of a plain
  // env var.
  async getClaudeUsage(): Promise<ClaudeUsage> {
    const accessToken = await this.getValidClaudeAccessToken();

    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });

    if (!response.ok) {
      throw new BadGatewayException(
        `Claude usage request failed (${response.status})`,
      );
    }

    const body = (await response.json()) as ClaudeUsageApiResponse;

    return {
      sessionPercent: body.five_hour.utilization,
      sessionResetsAt: body.five_hour.resets_at,
      weekPercent: body.seven_day.utilization,
      weekResetsAt: body.seven_day.resets_at,
      weekSonnetPercent: body.seven_day_sonnet?.utilization ?? null,
    };
  }
}
