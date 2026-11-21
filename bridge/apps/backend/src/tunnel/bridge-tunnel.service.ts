import os from 'node:os';
import path from 'node:path';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { ProxyAgent, request, type Dispatcher } from 'undici';

import { setTunnelProxy } from '../common/tunnel-proxy';
import { AppLogService } from '../logs/app-log.service';
import {
  AlertFallbackService,
  type FallbackChannel,
} from '../telegram/alert-fallback.service';
import { TelegramService } from '../telegram/telegram.service';
import { VpnLinkResolver } from '../vpn/vpn-link-resolver.service';
import { TunnelProcess } from './tunnel-process';

const CHECK_EVERY_MS = 20_000;
const PROBE_TIMEOUT_MS = 8_000;
const DEFAULT_PORT = 18081;

// What bridge needs to reach through the tunnel. Telegram is what decides whether the tunnel is used (alerts, the bot, the channel);
// GitHub is shown next to it.
export const TUNNEL_TARGETS = [
  { key: 'telegram', label: 'Telegram API', url: 'https://api.telegram.org/' },
  {
    key: 'github',
    label: 'GitHub API',
    // Answers 200 and does not count against the anonymous limit of the exit address.
    url: 'https://api.github.com/rate_limit',
  },
] as const;

export type TunnelTargetKey = (typeof TUNNEL_TARGETS)[number]['key'];

export interface TunnelCheck {
  key: TunnelTargetKey;
  label: string;
  ok: boolean;
  ms: number | null;
  error: string | null;
  at: string;
}

export interface BridgeTunnelStatus {
  // off = switched off (BRIDGE_TUNNEL=off) or xray is not installed in this image.
  mode: 'on' | 'off';
  reason: string | null;
  // The links of the active connection the tunnel was built from.
  links: number;
  // Whether Telegram traffic goes through it right now (it is up and Telegram answers through it).
  inUse: boolean;
  checks: TunnelCheck[];
  // When the state last changed (in use / not in use).
  since: string | null;
  // Whether Telegram can be reached at all (as the bot's own calls show it) and since when it cannot.
  telegram: {
    down: boolean;
    since: string | null;
    error: string | null;
  } | null;
  // The other way out for urgent alerts when Telegram is down: what is set up (nothing secret in it).
  fallback: { configured: boolean; channels: FallbackChannel[] } | null;
}

export type ProbeFn = (
  url: string,
  proxyUrl: string,
  timeoutMs: number,
) => Promise<number>;

// The status code of one GET through the proxy; TLS is verified (a certificate for another host is a failure, as it is for the worker's
// probes), the body is thrown away.
const defaultProbe: ProbeFn = async (url, proxyUrl, timeoutMs) => {
  const response = await request(url, {
    method: 'GET',
    headers: { 'user-agent': 'pipe-bridge-tunnel-check' },
    dispatcher: agentFor(proxyUrl),
    signal: AbortSignal.timeout(timeoutMs),
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });

  await response.body.dump();

  return response.statusCode;
};

let agent: { url: string; agent: Dispatcher } | null = null;

function agentFor(url: string): Dispatcher {
  if (agent?.url !== url) {
    agent?.agent.close().catch(() => undefined);
    agent = { url, agent: new ProxyAgent(url) };
  }

  return agent.agent;
}

export function describeProbeError(error: unknown): string {
  const err = error as
    | {
        name?: string;
        code?: string;
        message?: string;
        cause?: { code?: string };
      }
    | undefined;
  const code = err?.code ?? err?.cause?.code;

  if (err?.name === 'TimeoutError' || err?.name === 'AbortError')
    return 'timeout';

  return (code ?? err?.message ?? 'error').slice(0, 80);
}

// bridge's own way out: an Xray client built from the connection that is ACTIVE on the VPN page, so Telegram and GitHub follow the
// connection that was chosen there instead of a client configured once at deploy time. It is used only while it works — checked against
// the real services every 20 s, not merely listening — and otherwise the callers keep the proxy they were configured with.
@Injectable()
export class BridgeTunnelService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BridgeTunnelService.name);
  private readonly tunnel: TunnelProcess;
  private running = false;
  private disabledReason: string | null = null;
  private checks: TunnelCheck[] = [];
  private inUse = false;
  private since: string | null = null;
  // The probe is replaceable so a test does not need a network.
  probe: ProbeFn = defaultProbe;

  constructor(
    private readonly config: ConfigService,
    private readonly resolver: VpnLinkResolver,
    @Optional() private readonly appLogs?: AppLogService,
    @Optional() tunnel?: TunnelProcess,
    @Optional() private readonly telegram?: TelegramService,
    @Optional() private readonly fallback?: AlertFallbackService,
  ) {
    const port = Number(this.config.get('BRIDGE_TUNNEL_PORT')) || DEFAULT_PORT;

    this.tunnel =
      tunnel ??
      new TunnelProcess({
        dir: path.join(os.tmpdir(), 'bridge-tunnel'),
        xrayBin: this.config.get<string>('XRAY_BIN') || undefined,
        fingerprint: this.config.get<string>('BRIDGE_TUNNEL_FINGERPRINT'),
        port,
        log: {
          info: (message) => this.logger.log(message),
          warn: (message) => this.logger.warn(message),
          error: (message) => this.logger.error(message),
        },
      });

    if (
      ['off', '0', 'false'].includes(
        (this.config.get<string>('BRIDGE_TUNNEL') ?? '').trim().toLowerCase(),
      )
    ) {
      this.disabledReason = 'выключен (BRIDGE_TUNNEL=off)';
    }
  }

  onModuleInit(): void {
    if (this.disabledReason) {
      this.logger.log(`The bridge tunnel is ${this.disabledReason}`);

      return;
    }

    void this.check();
  }

  onModuleDestroy(): void {
    setTunnelProxy(null);
    this.tunnel.stop();
  }

  status(): BridgeTunnelStatus {
    const missing = this.tunnel.isMissing;

    return {
      mode: this.disabledReason || missing ? 'off' : 'on',
      reason:
        this.disabledReason ??
        (missing ? 'xray не установлен в этом образе' : null),
      links: this.tunnel.linkCount,
      inUse: this.inUse,
      checks: this.checks,
      since: this.since,
      telegram: this.telegram ? this.telegramHealth() : null,
      fallback: this.fallback
        ? {
            configured: this.fallback.isConfigured(),
            channels: this.fallback.channels(),
          }
        : null,
    };
  }

  private telegramHealth(): NonNullable<BridgeTunnelStatus['telegram']> {
    const health = (this.telegram as TelegramService).health();

    return {
      down: health.down,
      since: health.failingSince?.toISOString() ?? null,
      error: health.lastError,
    };
  }

  // The links of the active connection: [] when nothing is active (the tunnel is then stopped), undefined when the panel could not be
  // asked and nobody ever built them — the tunnel that already runs is left alone rather than dropped on a hiccup.
  private async activeLinks(): Promise<string[] | undefined> {
    try {
      return await this.resolver.resolveMany('active');
    } catch (error) {
      if (error instanceof NotFoundException) return [];

      this.logger.warn(
        `The links of the active connection could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );

      return undefined;
    }
  }

  @Interval(CHECK_EVERY_MS)
  async check(): Promise<void> {
    if (this.disabledReason || this.running || this.tunnel.isMissing) return;

    this.running = true;

    try {
      const links = await this.activeLinks();
      const proxy =
        links === undefined
          ? this.tunnel.linkCount > 0
            ? this.tunnel.proxyUrl
            : null
          : await this.tunnel.apply(links);

      if (!proxy) {
        this.checks = [];
        this.publish(
          false,
          links?.length === 0
            ? 'нет активного подключения'
            : 'туннель не поднят',
        );

        return;
      }

      this.checks = await Promise.all(
        TUNNEL_TARGETS.map((target) => this.checkTarget(target, proxy)),
      );

      const telegram = this.checks.find((entry) => entry.key === 'telegram');

      this.publish(
        telegram?.ok === true,
        telegram?.ok
          ? null
          : `Telegram через туннель не отвечает: ${telegram?.error ?? '—'}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async checkTarget(
    target: (typeof TUNNEL_TARGETS)[number],
    proxy: string,
  ): Promise<TunnelCheck> {
    const started = Date.now();
    const at = new Date().toISOString();

    try {
      const status = await this.probe(target.url, proxy, PROBE_TIMEOUT_MS);

      // Any answer is a path; a 5xx from the proxy or the service itself is not.
      return status >= 500
        ? {
            key: target.key,
            label: target.label,
            ok: false,
            ms: null,
            error: `HTTP ${status}`,
            at,
          }
        : {
            key: target.key,
            label: target.label,
            ok: true,
            ms: Date.now() - started,
            error: null,
            at,
          };
    } catch (error) {
      return {
        key: target.key,
        label: target.label,
        ok: false,
        ms: null,
        error: describeProbeError(error),
        at,
      };
    }
  }

  // Makes the tunnel the proxy of Telegram and GitHub callers, or stops doing so; a change is said once, in the log.
  private publish(usable: boolean, why: string | null): void {
    setTunnelProxy(usable ? this.tunnel.proxyUrl : null);

    if (usable === this.inUse) return;

    this.inUse = usable;
    this.since = new Date().toISOString();

    const message = usable
      ? 'Туннель bridge (активное подключение) работает: Telegram и GitHub идут через него'
      : `Туннель bridge не используется${why ? `: ${why}` : ''} — Telegram идёт через прокси из окружения`;

    this.logger[usable ? 'log' : 'warn'](message);
    void this.appLogs?.record({
      level: usable ? 'info' : 'warn',
      source: 'integration',
      event: usable ? 'tunnel.up' : 'tunnel.down',
      message,
    });
  }
}
