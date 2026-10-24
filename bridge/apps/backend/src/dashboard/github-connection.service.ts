import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Agent, fetch as undiciFetch, ProxyAgent } from 'undici';
import type { Dispatcher } from 'undici';
import { Repository } from 'typeorm';

import { setGithubProxyChoice } from '../common/github-dispatcher';
import { SystemSettings } from './entities/system-settings.entity';

// The VPN client of the stack — what Telegram already goes through.
export const DEFAULT_GITHUB_PROXY_URL = 'http://vpn-client:1080';
const SETTINGS_ID = 1;
// A second backend (the old one during a rolling update) or a restart must see a change soon.
const RELOAD_EVERY_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;
const PROBE_SAMPLES = 2;

export interface GithubConnectionState {
  // Whether the calls to GitHub go through the proxy right now.
  enabled: boolean;
  url: string;
  // setting = chosen here; environment = GITHUB_PROXY_URL of the stack; default = nothing chosen and nothing set.
  source: 'setting' | 'environment' | 'default';
}

export interface ProbeSample {
  ok: boolean;
  ms: number;
  status: number | null;
  error: string | null;
}

export interface GithubConnectionCheck {
  direct: ProbeSample[];
  // null when there is no proxy URL to try.
  proxy: ProbeSample[] | null;
  url: string;
}

export function normalizeProxyUrl(raw: string): string {
  const value = raw.trim();
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestException(
      'Адрес прокси должен быть вида http://host:порт',
    );
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !parsed.hostname
  ) {
    throw new BadRequestException(
      'Адрес прокси должен быть вида http://host:порт',
    );
  }

  return value;
}

async function probe(dispatcher: Dispatcher): Promise<ProbeSample> {
  const started = Date.now();

  try {
    const response = await undiciFetch('https://api.github.com/rate_limit', {
      dispatcher,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pipe-bridge',
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    await response.arrayBuffer();

    return {
      ok: response.ok,
      ms: Date.now() - started,
      status: response.status,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await dispatcher.close().catch(() => undefined);
  }
}

// A cold connection each time (a new agent per sample): it is the new connection that is slow, an open one answers at once.
async function sampleVia(
  make: () => Dispatcher,
  samples: number,
): Promise<ProbeSample[]> {
  const out: ProbeSample[] = [];

  for (let i = 0; i < samples; i += 1) out.push(await probe(make()));

  return out;
}

@Injectable()
export class GithubConnectionService implements OnModuleInit {
  private readonly logger = new Logger(GithubConnectionService.name);

  constructor(
    @InjectRepository(SystemSettings)
    private readonly settings: Repository<SystemSettings>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  @Interval(RELOAD_EVERY_MS)
  async reload(): Promise<void> {
    try {
      const row = await this.settings.findOne({ where: { id: SETTINGS_ID } });

      this.apply(row);
    } catch (error) {
      // The table may not exist yet (before the migration ran): the environment keeps deciding.
      this.logger.warn(
        `Could not load the GitHub connection setting: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private apply(row: SystemSettings | null): void {
    setGithubProxyChoice(
      row && row.githubProxyEnabled !== null
        ? {
            enabled: row.githubProxyEnabled,
            url: row.githubProxyUrl ?? DEFAULT_GITHUB_PROXY_URL,
          }
        : null,
    );
  }

  async state(): Promise<GithubConnectionState> {
    const row = await this.settings.findOne({ where: { id: SETTINGS_ID } });

    if (row && row.githubProxyEnabled !== null) {
      return {
        enabled: row.githubProxyEnabled,
        url: row.githubProxyUrl ?? DEFAULT_GITHUB_PROXY_URL,
        source: 'setting',
      };
    }

    const fromEnvironment = process.env.GITHUB_PROXY_URL?.trim();

    return fromEnvironment
      ? { enabled: true, url: fromEnvironment, source: 'environment' }
      : { enabled: false, url: DEFAULT_GITHUB_PROXY_URL, source: 'default' };
  }

  async save(enabled: boolean, url?: string): Promise<GithubConnectionState> {
    const current = await this.state();
    const next = url === undefined ? current.url : normalizeProxyUrl(url);
    const saved = await this.settings.save(
      this.settings.create({
        id: SETTINGS_ID,
        githubProxyEnabled: enabled,
        githubProxyUrl: next,
      }),
    );

    this.apply(saved);

    return this.state();
  }

  // Direct and through the proxy, side by side (the two chains run at the same time).
  async check(url?: string): Promise<GithubConnectionCheck> {
    const target =
      url === undefined || url.trim() === ''
        ? (await this.state()).url
        : normalizeProxyUrl(url);
    const [direct, proxy] = await Promise.all([
      sampleVia(() => new Agent(), PROBE_SAMPLES),
      sampleVia(() => new ProxyAgent(target), PROBE_SAMPLES),
    ]);

    return { direct, proxy, url: target };
  }
}
