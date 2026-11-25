import { Injectable, Logger, Optional } from '@nestjs/common';
import { ProxyAgent, request, type Dispatcher } from 'undici';

import { tunnelProxyUrl } from '../common/tunnel-proxy';
import { SecretsService } from '../secrets/secrets.service';
import {
  type ChannelFact,
  type ChannelRef,
  extractChannels,
  formatChannelFacts,
  type InstagramAccount,
  type InstagramPost,
  parseYoutubeChannelPage,
  parseYoutubeFeed,
} from './channel-facts';

// The owner's own Instagram token (Instagram API with Instagram login — a professional account), kept on the Secrets page.
export const INSTAGRAM_TOKEN_SECRET = 'INSTAGRAM_ACCESS_TOKEN';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const OK_TTL_MS = 6 * 60 * 60 * 1000;
const FAILED_TTL_MS = 10 * 60 * 1000;

export interface HttpResult {
  status: number;
  text: string;
}

export type HttpGet = (
  url: string,
  headers?: Record<string, string>,
) => Promise<HttpResult>;

let agent: { url: string; agent: Dispatcher } | null = null;

function dispatcher(): Dispatcher | undefined {
  // Through the bridge's own tunnel while it works (the active VPN connection), straight otherwise.
  const url = tunnelProxyUrl();

  if (!url) return undefined;

  if (agent?.url !== url) {
    agent?.agent.close().catch(() => undefined);
    agent = { url, agent: new ProxyAgent(url) };
  }

  return agent.agent;
}

const MAX_REDIRECTS = 3;

const defaultGet: HttpGet = async (url, headers = {}) => {
  let target = url;

  for (let hops = 0; ; hops++) {
    const response = await request(target, {
      method: 'GET',
      headers,
      dispatcher: dispatcher(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headersTimeout: FETCH_TIMEOUT_MS,
      bodyTimeout: FETCH_TIMEOUT_MS,
    });
    const location = response.headers.location;

    if (
      response.statusCode >= 300 &&
      response.statusCode < 400 &&
      typeof location === 'string' &&
      hops < MAX_REDIRECTS
    ) {
      await response.body.dump();
      // A redirect never takes the headers to another host (the cookie and the token stay where they were meant for).
      const next = new URL(location, target);

      if (next.host !== new URL(target).host) {
        return { status: response.statusCode, text: '' };
      }

      target = next.toString();
      continue;
    }

    const chunks: Buffer[] = [];
    let size = 0;

    for await (const chunk of response.body) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) break;
      chunks.push(chunk as Buffer);
    }

    return {
      status: response.statusCode,
      text: Buffer.concat(chunks).toString('utf-8'),
    };
  }
};

const BROWSER_HEADERS = {
  // The public channel page as an ordinary browser gets it (English, cookie notice already answered).
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
  cookie: 'CONSENT=YES+1; SOCS=CAI',
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// Reads the public channels a task names (Lab today; /promo's own statistics and, later, its publishing use the same reader) and turns them into a text block for the run. What it never does: log in to anything, pretend to
// be an app or a crawler, or read a page that sits behind a login. YouTube is read from its public page and Atom feed; Instagram only through
// its official API with the owner's own token (no token → the block says so and the run goes on without the numbers).
@Injectable()
export class ChannelFactsService {
  private readonly logger = new Logger(ChannelFactsService.name);
  private readonly cache = new Map<
    string,
    { at: number; ttl: number; fact: ChannelFact }
  >();
  // Replaceable, so a test needs no network.
  get: HttpGet = defaultGet;

  constructor(@Optional() private readonly secrets?: SecretsService) {}

  // The block for a task; '' when it names no channel. Never throws: facts are an addition to the run, never a reason to lose it.
  async describeFor(userId: number, task: string): Promise<string> {
    try {
      const refs = extractChannels(task);

      if (refs.length === 0) return '';

      const facts = await Promise.all(
        refs.map((ref) => this.factFor(userId, ref)),
      );

      return formatChannelFacts(facts, new Date());
    } catch (error) {
      this.logger.warn(`Channel facts skipped: ${errorText(error)}`);

      return '';
    }
  }

  private async factFor(userId: number, ref: ChannelRef): Promise<ChannelFact> {
    const key = `${userId}:${ref.kind}:${ref.handle.toLowerCase()}`;
    const hit = this.cache.get(key);

    if (hit && Date.now() - hit.at < hit.ttl) return hit.fact;

    let fact: ChannelFact;

    try {
      fact =
        ref.kind === 'youtube'
          ? await this.youtube(ref)
          : await this.instagram(userId, ref);
    } catch (error) {
      this.logger.warn(`${ref.kind} ${ref.handle}: ${errorText(error)}`);
      fact = { ref, ok: false, reason: 'сайт не ответил вовремя' };
    }

    this.cache.set(key, {
      at: Date.now(),
      ttl: fact.ok ? OK_TTL_MS : FAILED_TTL_MS,
      fact,
    });

    return fact;
  }

  private async youtube(ref: ChannelRef): Promise<ChannelFact> {
    const page = await this.get(`${ref.url}/videos?hl=en`, BROWSER_HEADERS);

    if (page.status !== 200) {
      return {
        ref,
        ok: false,
        reason: `страница канала ответила ${page.status}`,
      };
    }

    const youtube = parseYoutubeChannelPage(page.text);

    if (!youtube.title && !youtube.subscribers && !youtube.channelId) {
      return {
        ref,
        ok: false,
        reason:
          'на странице нет данных канала (вместо неё — окно согласия или другая страница)',
      };
    }

    let feed: ReturnType<typeof parseYoutubeFeed> = [];

    if (youtube.channelId) {
      const response = await this.get(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${youtube.channelId}`,
        BROWSER_HEADERS,
      ).catch(() => null);

      if (response?.status === 200) feed = parseYoutubeFeed(response.text);
    }

    return { ref, ok: true, youtube, feed };
  }

  private async instagram(
    userId: number,
    ref: ChannelRef,
  ): Promise<ChannelFact> {
    const token = await this.secrets?.findValueByName(
      userId,
      INSTAGRAM_TOKEN_SECRET,
    );

    if (!token) {
      return {
        ref,
        ok: false,
        reason: `Instagram отдаёт данные только владельцу через официальный API, а токен не подключён (Секреты → ${INSTAGRAM_TOKEN_SECRET})`,
      };
    }

    const base = 'https://graph.instagram.com';
    const query = (path: string, fields: string, extra = '') =>
      `${base}/${path}?fields=${fields}${extra}&access_token=${encodeURIComponent(token)}`;
    const me = await this.get(
      query(
        'me',
        'username,name,biography,followers_count,follows_count,media_count',
      ),
    );

    // The token is never part of a message: only the status is.
    if (me.status !== 200) {
      return {
        ref,
        ok: false,
        reason:
          me.status === 400 || me.status === 401 || me.status === 403
            ? `токен ${INSTAGRAM_TOKEN_SECRET} недействителен или истёк (HTTP ${me.status}) — выпустите новый`
            : `API Instagram ответил ${me.status}`,
      };
    }

    const body = JSON.parse(me.text) as {
      username?: string;
      name?: string;
      biography?: string;
      followers_count?: number;
      follows_count?: number;
      media_count?: number;
    };

    if (
      !body.username ||
      body.username.toLowerCase() !== ref.handle.toLowerCase()
    ) {
      return {
        ref,
        ok: false,
        reason: `токен относится к другому профилю (@${body.username ?? '?'}), а не к @${ref.handle}`,
      };
    }

    const instagram: InstagramAccount = {
      username: body.username,
      name: body.name ?? null,
      biography: body.biography ?? null,
      followers: body.followers_count ?? null,
      following: body.follows_count ?? null,
      mediaCount: body.media_count ?? null,
    };
    let posts: InstagramPost[] = [];
    const media = await this.get(
      query('me/media', 'caption,timestamp,media_type', '&limit=12'),
    ).catch(() => null);

    if (media?.status === 200) {
      const data = (
        JSON.parse(media.text) as {
          data?: Array<{
            caption?: string;
            timestamp?: string;
            media_type?: string;
          }>;
        }
      ).data;

      posts = (data ?? []).map((item) => ({
        caption: item.caption ?? null,
        timestamp: item.timestamp ?? '',
        type: item.media_type ?? null,
      }));
    }

    return { ref, ok: true, instagram, posts };
  }
}
