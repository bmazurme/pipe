import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

const SEND_TIMEOUT_MS = 12_000;
// Urgent notices that arrive while Telegram is down are sent together, not one message each.
const MIRROR_WINDOW_MS = 5_000;
const MIRROR_MAX_LINES = 10;
// The same text again within this time is not repeated (a status that is re-announced every few minutes).
const MIRROR_DEDUPE_MS = 10 * 60_000;

export interface FallbackChannel {
  name: 'webhook' | 'email';
  // Where it goes, with nothing secret in it: the host of a webhook, the address of a mailbox.
  target: string;
}

// A second way to reach the owner when Telegram cannot be reached — the failure this exists for is exactly the one that silences every
// other alert. It takes nothing from Telegram or from the bridge's own tunnel: a webhook (ntfy-compatible: a plain POST of the text; or
// JSON) and/or e-mail, each switched on by its own environment variables:
//   ALERT_WEBHOOK_URL [, ALERT_WEBHOOK_FORMAT=ntfy|json, ALERT_WEBHOOK_TOKEN]
//   ALERT_SMTP_URL (smtps://user:pass@host:465), ALERT_EMAIL_TO [, ALERT_EMAIL_FROM]
// Nothing here ever throws: a broken fallback must not take down the thing that tried to use it.
@Injectable()
export class AlertFallbackService implements OnModuleDestroy {
  private readonly logger = new Logger(AlertFallbackService.name);
  private buffer: string[] = [];
  private seen = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private mailer: Transporter | null = null;
  // Replaceable, so a test needs neither a network nor a mail server.
  transportFactory: (url: string) => Transporter = (url) =>
    createTransport({
      url,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

  constructor(private readonly config: ConfigService) {}

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private webhookUrl(): string | undefined {
    return this.config.get<string>('ALERT_WEBHOOK_URL')?.trim() || undefined;
  }

  private emailTo(): string | undefined {
    return this.config.get<string>('ALERT_EMAIL_TO')?.trim() || undefined;
  }

  private smtpUrl(): string | undefined {
    return this.config.get<string>('ALERT_SMTP_URL')?.trim() || undefined;
  }

  channels(): FallbackChannel[] {
    const channels: FallbackChannel[] = [];
    const webhook = this.webhookUrl();

    if (webhook) {
      try {
        const url = new URL(webhook);

        channels.push({ name: 'webhook', target: url.host });
      } catch {
        // an address that is not a URL is not a channel
      }
    }

    if (this.smtpUrl() && this.emailTo()) {
      channels.push({ name: 'email', target: this.emailTo() as string });
    }

    return channels;
  }

  isConfigured(): boolean {
    return this.channels().length > 0;
  }

  // At once, to every channel; true when at least one took it.
  async send(text: string): Promise<boolean> {
    const results = await Promise.all([
      this.sendWebhook(text),
      this.sendEmail(text),
    ]);

    return results.some(Boolean);
  }

  // Something urgent that Telegram did not carry: held for a few seconds so a burst becomes one message, and never repeated verbatim
  // within ten minutes.
  mirror(text: string, now = Date.now()): void {
    if (!this.isConfigured()) return;

    for (const [key, at] of this.seen) {
      if (now - at > MIRROR_DEDUPE_MS) this.seen.delete(key);
    }

    if (this.seen.has(text)) return;

    this.seen.set(text, now);
    this.buffer.push(text);

    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flushMirror();
      }, MIRROR_WINDOW_MS);
      this.timer.unref?.();
    }
  }

  async flushMirror(): Promise<boolean> {
    if (this.buffer.length === 0) return false;

    const lines = this.buffer.splice(0);
    const shown = lines.slice(0, MIRROR_MAX_LINES);
    const rest = lines.length - shown.length;
    const text = [
      'Telegram недоступен, срочные уведомления:',
      ...shown.map((line) => `• ${line}`),
      ...(rest > 0 ? [`… и ещё ${rest}`] : []),
    ].join('\n');

    return this.send(text);
  }

  private async sendWebhook(text: string): Promise<boolean> {
    const url = this.webhookUrl();

    if (!url) return false;

    const json =
      (this.config.get<string>('ALERT_WEBHOOK_FORMAT') ?? '')
        .trim()
        .toLowerCase() === 'json';
    const token = this.config.get<string>('ALERT_WEBHOOK_TOKEN')?.trim();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...(json
            ? { 'Content-Type': 'application/json' }
            : {
                Priority: 'high',
                Tags: 'warning',
                'Content-Type': 'text/plain; charset=utf-8',
              }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: json ? JSON.stringify({ text, message: text }) : text,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(`The alert webhook answered HTTP ${response.status}`);

        return false;
      }

      return true;
    } catch (error) {
      this.logger.warn(
        `The alert webhook could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      );

      return false;
    }
  }

  private async sendEmail(text: string): Promise<boolean> {
    const smtp = this.smtpUrl();
    const to = this.emailTo();

    if (!smtp || !to) return false;

    try {
      this.mailer ??= this.transportFactory(smtp);

      await this.mailer.sendMail({
        from: this.config.get<string>('ALERT_EMAIL_FROM')?.trim() || undefined,
        to,
        subject: `pipe: ${text.split('\n')[0].slice(0, 120)}`,
        text,
      });

      return true;
    } catch (error) {
      this.logger.warn(
        `The alert e-mail could not be sent: ${error instanceof Error ? error.message : String(error)}`,
      );
      // A new connection next time rather than a dead one.
      this.mailer = null;

      return false;
    }
  }
}
