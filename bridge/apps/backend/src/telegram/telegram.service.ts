import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TELEGRAM_TIMEOUT_MS = 10_000;
// Telegram rejects a message over 4096 characters outright.
const TELEGRAM_MAX_TEXT = 4000;

// Outbound half of the Telegram integration: one bot, one owner chat. Every
// send is best-effort — a Telegram outage must never fail the webhook/job
// handler that triggered the notification.
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

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
    const token = this.botToken();

    if (!token || !chatId) {
      return false;
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: text.slice(0, TELEGRAM_MAX_TEXT),
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        this.logger.warn(
          `Telegram sendMessage failed: HTTP ${response.status}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.warn(
        `Telegram sendMessage failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private botToken(): string | undefined {
    return this.configService.get<string>('TELEGRAM_BOT_TOKEN') || undefined;
  }
}
