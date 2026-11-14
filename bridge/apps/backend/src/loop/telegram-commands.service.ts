import { Injectable, Optional } from '@nestjs/common';

import { BoardsService } from '../boards/boards.service';
import { RouterService } from '../boards/router.service';
import { TelegramChatsService } from '../telegram/telegram-chats.service';
import type {
  ObservedUpdate,
  TelegramChatInfo,
} from '../telegram/telegram-chats';
import { TelegramService } from '../telegram/telegram.service';
import { LoopControlService } from './loop-control.service';
import { LoopService } from './loop.service';
import { MergeService } from './merge.service';

export interface TelegramUpdate extends ObservedUpdate {
  update_id?: number;
  message?: { text?: string; chat?: TelegramChatInfo };
  callback_query?: {
    id?: string;
    data?: string;
    message?: { chat?: { id?: number } };
  };
}

const HELP_TEXT =
  '/status — последние циклы\n/pause [причина] — остановить новую автоматическую работу\n/resume — продолжить\n/router — состояние роутера и перезагрузка\n/help — эта справка';
const MAX_REASON = 200;
const ROUTER_CONFIRM_MINUTES = 5;

// Command handling shared by both ways an update can arrive: the webhook
// controller and the long-polling loop. Lives in the loop module (not
// telegram/) because commands act on the loop, and the loop already depends
// on TelegramService for notifications — the other direction would be a
// module cycle.
@Injectable()
export class TelegramCommandsService {
  constructor(
    private readonly loopService: LoopService,
    private readonly telegram: TelegramService,
    private readonly merges: MergeService,
    private readonly boards: BoardsService,
    // Optional in tests that do not exercise it.
    @Optional() private readonly control?: LoopControlService,
    @Optional() private readonly router?: RouterService,
    @Optional() private readonly chats?: TelegramChatsService,
  ) {}

  async handle(update: TelegramUpdate): Promise<void> {
    // Which channels and groups the bot is in (for the promo bindings); a chat that is not the owner's is otherwise ignored below.
    await this.chats?.observe(update);

    if (update.callback_query) {
      await this.handleCallback(update.callback_query);

      return;
    }

    const chatId = update.message?.chat?.id;
    const text = update.message?.text;

    // Everyone but the owner chat is ignored silently.
    if (
      chatId === undefined ||
      !text ||
      String(chatId) !== this.telegram.chatId()
    ) {
      return;
    }

    // "/status@my_bot" → "/status"
    const command = text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();

    if (command === '/status') {
      await this.telegram.send(await this.loopService.statusText());
    } else if (command === '/pause' && this.control) {
      const reason = text
        .trim()
        .split(/\s+/)
        .slice(1)
        .join(' ')
        .slice(0, MAX_REASON);

      await this.control.pause(
        reason || 'остановлено командой /pause',
        'telegram',
      );
      await this.telegram.send(
        '⏸ Автоматика на паузе: новые анализы, запуски по расписанию, автозапуск посылок и работа с открытыми PR не стартуют. Влить PR и запустить что-то вручную можно. /resume — продолжить.',
      );
    } else if (command === '/resume' && this.control) {
      const was = await this.control.resume();

      await this.telegram.send(
        was
          ? '▶️ Автоматика продолжает работу.'
          : 'Автоматика и не была на паузе.',
      );
    } else if (command === '/router' && this.router) {
      await this.telegram.sendWithButtons(await this.router.statusText(), [
        [{ text: '🔄 Перезагрузить роутер', callback_data: 'rr:ask' }],
      ]);
    } else if (command === '/help' || command === '/start') {
      await this.telegram.send(HELP_TEXT);
    }
  }

  // A press on an inline button. Only the owner chat counts, and the only
  // action is `merge:<pr>:<sha7>` — everything else is ignored.
  private async handleCallback(
    query: NonNullable<TelegramUpdate['callback_query']>,
  ): Promise<void> {
    const chatId = query.message?.chat?.id;

    if (
      !query.id ||
      chatId === undefined ||
      String(chatId) !== this.telegram.chatId()
    ) {
      return;
    }

    // `su:<board>:<sha7>` — the owner allows a board to bring its scripts up to `main` at that commit.
    const update = /^su:([A-Za-z0-9][A-Za-z0-9._-]{0,98}):([0-9a-f]{7})$/.exec(
      query.data ?? '',
    );

    if (update) {
      await this.telegram.answerCallback(query.id, 'Разрешаю обновление…');
      await this.telegram.send(
        await this.boards.approveFromTelegram(update[1], update[2]),
      );

      return;
    }

    // The router reboot is asked twice, so a stray tap does not cut the home link: `rr:ask` shows the question, `rr:go:<minute>` answers it
    // (the minute is when the question was asked: a button from long ago is refused), `rr:no` drops it.
    if (this.router && query.data === 'rr:ask') {
      await this.telegram.answerCallback(query.id);
      await this.telegram.sendWithButtons(
        'Перезагрузить роутер? Интернет и Wi-Fi пропадут примерно на 1–2 минуты. Кнопка действует 5 минут.',
        [
          [
            {
              text: '✅ Да, перезагрузить',
              callback_data: `rr:go:${Math.floor(Date.now() / 60_000)}`,
            },
            { text: 'Отмена', callback_data: 'rr:no' },
          ],
        ],
      );

      return;
    }
    if (this.router && query.data === 'rr:no') {
      await this.telegram.answerCallback(query.id, 'Отменено');

      return;
    }

    const go = /^rr:go:(\d+)$/.exec(query.data ?? '');

    if (this.router && go) {
      const askedMinutesAgo = Math.floor(Date.now() / 60_000) - Number(go[1]);

      if (askedMinutesAgo > ROUTER_CONFIRM_MINUTES) {
        await this.telegram.answerCallback(query.id, 'Кнопка устарела');
        await this.telegram.send('Кнопка устарела. /router — спросить снова.');

        return;
      }

      await this.telegram.answerCallback(query.id, 'Запрашиваю…');
      await this.telegram.send(await this.router.requestFromTelegram());

      return;
    }

    const match = /^merge:(\d+):([0-9a-f]{7,40})$/.exec(query.data ?? '');

    if (!match) {
      await this.telegram.answerCallback(query.id);

      return;
    }

    await this.telegram.answerCallback(query.id, 'Проверяю и вливаю…');
    await this.telegram.send(
      await this.merges.merge(Number(match[1]), match[2]),
    );
  }
}
