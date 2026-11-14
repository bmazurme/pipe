import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProxyAgent, type Dispatcher } from 'undici';

import { AppLogService } from '../logs/app-log.service';

const TELEGRAM_TIMEOUT_MS = 10_000;

// `uncertain`: no answer came back (a timeout, a dropped connection), so the request may still have been carried out — as opposed to
// Telegram answering «no». A caller that sends something to a channel must not just try again.
export type TelegramResult<T> =
  { ok: true; result: T } | { ok: false; reason: string; uncertain?: boolean };

export type InlineButton =
  { text: string; callback_data: string } | { text: string; url: string };
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

  // One stored log per method per window: the poller retries a dead network
  // every few seconds, which must not turn into thousands of identical rows.
  private lastLoggedFailure = new Map<string, number>();

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly appLogs?: AppLogService,
  ) {}

  private logFailure(method: string, reason: string): void {
    const now = Date.now();

    if (now - (this.lastLoggedFailure.get(method) ?? 0) < 5 * 60_000) {
      return;
    }

    this.lastLoggedFailure.set(method, now);
    void this.appLogs?.record({
      level: 'warn',
      source: 'integration',
      event: 'telegram.api_failed',
      message: `Telegram ${method} failed: ${reason}`,
      meta: { method },
    });
  }

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

  // A message with an inline keyboard. A button either carries
  // `callback_data` (the press comes back as a callback_query update — max 64
  // bytes) or a `url` (just opens a link).
  async sendWithButtons(
    text: string,
    buttons: InlineButton[][],
  ): Promise<boolean> {
    const chatId = this.chatId();

    if (!chatId) {
      return false;
    }

    return (
      (await this.api('sendMessage', {
        chat_id: chatId,
        text: text.slice(0, TELEGRAM_MAX_TEXT),
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: buttons },
      })) !== null
    );
  }

  // Stops the button's spinner; `text` shows as a brief toast.
  async answerCallback(callbackQueryId: string, text?: string): Promise<void> {
    await this.api('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text: text.slice(0, 200) } : {}),
    });
  }

  // Raw Bot API call. Returns the `result` field, or null on any failure
  // (not configured, network error, non-2xx, `ok: false`) — callers that
  // need to tell those apart (the poller's backoff) just log from here.
  async api<T = unknown>(
    method: string,
    body: Record<string, unknown>,
    timeoutMs = TELEGRAM_TIMEOUT_MS,
  ): Promise<T | null> {
    const response = await this.request<T>(method, body, timeoutMs);

    return response.ok ? response.result : null;
  }

  // The same call, but a failure says why («Bad Request: chat not found»): the promo module shows that reason to the owner when
  // binding a channel or posting. `body` may be a FormData (sendPhoto/sendVideo/sendMediaGroup upload the file itself).
  async request<T = unknown>(
    method: string,
    body: Record<string, unknown> | FormData,
    timeoutMs = TELEGRAM_TIMEOUT_MS,
  ): Promise<TelegramResult<T>> {
    const token = this.botToken();

    if (!token) {
      return { ok: false, reason: 'бот не настроен (TELEGRAM_BOT_TOKEN)' };
    }

    const isForm = body instanceof FormData;

    try {
      // `dispatcher` is a Node/undici-specific fetch extension not in the
      // standard RequestInit type — real at runtime, just untyped here.
      const response = await fetch(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          method: 'POST',
          // A FormData sets its own multipart boundary header.
          headers: isForm ? undefined : { 'Content-Type': 'application/json' },
          body: isForm ? body : JSON.stringify(body),
          dispatcher: this.dispatcher(),
          signal: AbortSignal.timeout(timeoutMs),
        } as RequestInit,
      );
      const data = (
        typeof response.json === 'function'
          ? await response.json().catch(() => ({}))
          : {}
      ) as { ok?: boolean; result?: T; description?: string };

      if (!response.ok) {
        const reason = data.description ?? `HTTP ${response.status}`;

        this.logger.warn(`Telegram ${method} failed: HTTP ${response.status}`);
        this.logFailure(method, `HTTP ${response.status}`);

        return { ok: false, reason };
      }

      // Some callers/tests only care about 2xx; a body without `ok` is
      // treated as success with an empty result.
      if (data.ok === false) {
        return { ok: false, reason: data.description ?? 'Telegram отказал' };
      }

      return { ok: true, result: data.result ?? (true as T) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Telegram ${method} failed: ${reason}`);
      this.logFailure(method, reason);

      return {
        ok: false,
        reason: `нет связи с Telegram: ${reason}`,
        uncertain: true,
      };
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
