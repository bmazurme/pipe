import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProxyAgent, type Dispatcher } from 'undici';

const TELEGRAM_TIMEOUT_MS = 10_000;
// Telegram rejects a message over 4096 characters outright.
const TELEGRAM_MAX_TEXT = 4000;

// The bot's side of the Telegram integration: one bot, one owner chat. Every
// call is best-effort — a Telegram outage must never fail the handler that
// triggered a notification. All traffic can be routed through an HTTP proxy
// (TELEGRAM_PROXY_URL, the stack's vpn-client): the production host cannot
// reach api.telegram.org directly.
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private proxy: { url: string; agent: Dispatcher } | undefined;

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.botToken() && this.chatId());
  }

  // The only chat the bot talks to and takes commands from.
  chatId(): string | undefined {
    return this.configService.get<string>('TELEGRAM_CHAT_ID') || undefined;
  }

  // Plain text on purpose (no parse_mode): run titles and error messages come
  // from model output and would otherwise need Markdown/HTML escaping.
  async send(text: string, chatId = this.chatId()): Promise<boolean> {
    if (!chatId) {
      return false;
    }

    const result = await this.api('sendMessage', {
      chat_id: chatId,
      text: text.slice(0, TELEGRAM_MAX_TEXT),
      disable_web_page_preview: true,
    });

    return result !== null;
  }

  // Raw Bot API call. Returns the `result` field, or null on any failure
  // (not configured, network error, non-2xx, `ok: false`) — callers that
  // need to tell those apart (the poller's backoff) just log from here.
  async api<T = unknown>(
    method: string,
    body: Record<string, unknown>,
    timeoutMs = TELEGRAM_TIMEOUT_MS,
  ): Promise<T | null> {
    const token = this.botToken();

    if (!token) {
      return null;
    }

    try {
      // `dispatcher` is a Node/undici-specific fetch extension not in the
      // standard RequestInit type — real at runtime, just untyped here.
      const response = await fetch(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          dispatcher: this.dispatcher(),
          signal: AbortSignal.timeout(timeoutMs),
        } as RequestInit,
      );

      if (!response.ok) {
        this.logger.warn(`Telegram ${method} failed: HTTP ${response.status}`);
        return null;
      }

      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: T;
      };

      // Some callers/tests only care about 2xx; a body without `ok` is
      // treated as success with an empty result.
      return data.ok === false ? null : (data.result ?? (true as T));
    } catch (error) {
      this.logger.warn(
        `Telegram ${method} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  // Built once per proxy URL — ProxyAgent keeps its own connection pool.
  private dispatcher(): Dispatcher | undefined {
    const url = this.configService.get<string>('TELEGRAM_PROXY_URL');

    if (!url) {
      return undefined;
    }

    if (this.proxy?.url !== url) {
      this.proxy = { url, agent: new ProxyAgent(url) };
    }

    return this.proxy.agent;
  }

  private botToken(): string | undefined {
    return this.configService.get<string>('TELEGRAM_BOT_TOKEN') || undefined;
  }
}
