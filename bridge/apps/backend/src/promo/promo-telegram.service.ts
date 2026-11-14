import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { FILE_STORE, type FileStore } from '../storage/file-store/file-store';
import { TelegramChatsService } from '../telegram/telegram-chats.service';
import { TelegramService } from '../telegram/telegram.service';
import { PromoAsset } from './entities/promo-asset.entity';
import { PromoPost } from './entities/promo-post.entity';
import {
  PromoTelegramTarget,
  type TelegramRole,
} from './entities/promo-telegram-target.entity';
import { joinCaption } from './promo-limits';
import {
  messageUrl,
  parseChatRef,
  planSend,
  toTelegramHtml,
  type MediaFile,
  type SendPlan,
} from './telegram-format';

export interface TargetView {
  role: TelegramRole;
  chatId: string;
  title: string | null;
  username: string | null;
}

export interface CandidateView {
  chatId: string;
  type: string;
  title: string | null;
  username: string | null;
  botStatus: string | null;
  // The roles this chat could be bound as: a channel is the news, a group is the discussion.
  roles: TelegramRole[];
}

export interface TelegramState {
  botConfigured: boolean;
  news: TargetView | null;
  discussion: TargetView | null;
  candidates: CandidateView[];
}

export interface PublishResult {
  messageId: number;
  url: string | null;
  // The post is out, but the note in the group was not: say so, do not fail the post.
  announceError: string | null;
}

interface ChatInfo {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

interface Message {
  message_id: number;
}

const fail = (message: string) => new BadRequestException(message);
const asTarget = (row: PromoTelegramTarget | null): TargetView | null =>
  row
    ? {
        role: row.role,
        chatId: row.chatId,
        title: row.title,
        username: row.username,
      }
    : null;

// Everything about Telegram that the promo module does: which channel and group the posts go to, and sending a post there.
@Injectable()
export class PromoTelegramService {
  private botId: number | null = null;

  constructor(
    @InjectRepository(PromoTelegramTarget)
    private readonly targets: Repository<PromoTelegramTarget>,
    @InjectRepository(PromoAsset)
    private readonly assets: Repository<PromoAsset>,
    @Inject(FILE_STORE) private readonly store: FileStore,
    private readonly telegram: TelegramService,
    private readonly chats: TelegramChatsService,
  ) {}

  async state(): Promise<TelegramState> {
    const [rows, seen] = await Promise.all([
      this.targets.find(),
      this.chats.list(),
    ]);

    return {
      botConfigured: this.telegram.isConfigured(),
      news: asTarget(rows.find((row) => row.role === 'news') ?? null),
      discussion: asTarget(
        rows.find((row) => row.role === 'discussion') ?? null,
      ),
      // Chats the bot was removed from are not offered.
      candidates: seen
        .filter(
          (chat) => chat.botStatus !== 'left' && chat.botStatus !== 'kicked',
        )
        .map((chat) => ({
          chatId: chat.chatId,
          type: chat.type,
          title: chat.title,
          username: chat.username,
          botStatus: chat.botStatus,
          roles:
            chat.type === 'channel'
              ? ['news' as const]
              : ['discussion' as const],
        })),
    };
  }

  async news(): Promise<PromoTelegramTarget | null> {
    return this.targets.findOne({ where: { role: 'news' } });
  }

  // Binds a chat to a role after asking Telegram about it: the chat exists, is the right kind, and the bot can do its job there.
  async bind(role: TelegramRole, input: string): Promise<TargetView> {
    const ref = parseChatRef(input);

    if (!ref) {
      throw fail(
        'Укажите числовой id (-100…), @имя или ссылку t.me/имя. Приватная ссылка-приглашение (t.me/+…) не подходит: нужен id, он появится в списке, когда бот увидит чат',
      );
    }

    const chat = await this.call<ChatInfo>(
      'getChat',
      { chat_id: ref },
      'чат не найден или бот в нём не состоит',
    );

    if (role === 'news' && chat.type !== 'channel') {
      throw fail(
        `«${chat.title ?? ref}» — не канал, а ${chat.type === 'private' ? 'личный чат' : 'группа'}. Новости привязываются к каналу`,
      );
    }

    if (
      role === 'discussion' &&
      chat.type !== 'group' &&
      chat.type !== 'supergroup'
    ) {
      throw fail(
        `«${chat.title ?? ref}» — не группа, а ${chat.type === 'channel' ? 'канал' : 'личный чат'}. Обсуждения привязываются к группе`,
      );
    }

    const member = await this.call<{
      status: string;
      can_post_messages?: boolean;
      can_send_messages?: boolean;
    }>(
      'getChatMember',
      { chat_id: chat.id, user_id: await this.me() },
      'не удалось узнать права бота в чате',
    );

    if (role === 'news') {
      const admin =
        member.status === 'administrator' || member.status === 'creator';

      if (!admin || member.can_post_messages === false) {
        throw fail(
          'Бот должен быть администратором канала с правом публиковать сообщения',
        );
      }
    } else if (
      !['member', 'administrator', 'creator'].includes(member.status) &&
      !(member.status === 'restricted' && member.can_send_messages)
    ) {
      throw fail(
        'Бота нет в группе или ему нельзя писать: добавьте его участником с правом отправлять сообщения',
      );
    }

    await this.targets.save(
      this.targets.create({
        role,
        chatId: String(chat.id),
        title: chat.title ?? null,
        username: chat.username ?? null,
        boundAt: new Date(),
      }),
    );

    return {
      role,
      chatId: String(chat.id),
      title: chat.title ?? null,
      username: chat.username ?? null,
    };
  }

  async unbind(role: TelegramRole): Promise<void> {
    await this.targets.delete({ role });
  }

  // Sends the post to the news channel (and the note to the group, when asked). Throws the reason when it could not.
  async publish(post: PromoPost): Promise<PublishResult> {
    const news = await this.news();

    if (!news)
      throw fail('Канал новостей не привязан (Промо → Обзор → Telegram)');

    const messageId = await this.send(news.chatId, post);
    const url = messageUrl(news, messageId);
    let announceError: string | null = null;

    if (post.announceInGroup) {
      announceError = await this.announce(post, url);
    }

    return { messageId, url, announceError };
  }

  // The same post, to the owner's own chat only: a preview before it goes to the channel.
  async sendTest(post: PromoPost): Promise<void> {
    const chatId = this.telegram.chatId();

    if (!this.telegram.isConfigured() || !chatId) {
      throw fail('Бот не настроен (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)');
    }

    await this.send(chatId, post);
  }

  // --- internals

  private async announce(
    post: PromoPost,
    url: string | null,
  ): Promise<string | null> {
    const group = await this.targets.findOne({ where: { role: 'discussion' } });

    if (!group) return 'группа обсуждений не привязана';

    const result = await this.telegram.request<Message>('sendMessage', {
      chat_id: group.chatId,
      text: `Новый пост в канале: «${post.title}»`,
      disable_web_page_preview: true,
      ...(url
        ? {
            reply_markup: {
              inline_keyboard: [[{ text: 'Открыть пост', url }]],
            },
          }
        : {}),
    });

    return result.ok ? null : result.reason;
  }

  private async send(chatId: string, post: PromoPost): Promise<number> {
    const rows =
      post.assetIds.length > 0
        ? await this.assets.find({ where: { id: In(post.assetIds) } })
        : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = post.assetIds.map((id) => byId.get(id));

    if (ordered.some((row) => !row))
      throw fail('Какого-то из файлов поста уже нет');

    const files: MediaFile[] = (ordered as PromoAsset[]).map((row) => ({
      id: row.id,
      name: row.originalName,
      mime: row.mime,
      size: row.size,
    }));
    let plan: SendPlan;

    try {
      plan = planSend(files);
    } catch (error) {
      throw fail(error instanceof Error ? error.message : String(error));
    }

    const caption = toTelegramHtml(joinCaption(post.textRu, post.textEn));
    const bytesOf = async (id: number) => {
      const row = byId.get(id)!;
      const bytes = await this.store.readBytes(`promo/${row.storedName}`);

      return new Blob([new Uint8Array(bytes)], { type: row.mime });
    };

    if (plan.kind === 'text') {
      const sent = await this.call<Message>('sendMessage', {
        chat_id: chatId,
        text: caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      return sent.message_id;
    }

    const form = new FormData();

    form.append('chat_id', chatId);

    if (plan.kind === 'single') {
      form.append(plan.field, await bytesOf(plan.file.id), plan.file.name);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');

      return (await this.call<Message>(plan.method, form)).message_id;
    }

    const media: Record<string, unknown>[] = [];

    for (const [index, file] of plan.files.entries()) {
      form.append(`file${index}`, await bytesOf(file.id), file.name);
      media.push({
        type: file.mime.startsWith('video/') ? 'video' : 'photo',
        media: `attach://file${index}`,
        // The caption of an album is the first item's.
        ...(index === 0 ? { caption, parse_mode: 'HTML' } : {}),
      });
    }

    form.append('media', JSON.stringify(media));

    return (await this.call<Message[]>('sendMediaGroup', form))[0].message_id;
  }

  private async me(): Promise<number> {
    if (this.botId === null) {
      this.botId = (
        await this.call<{ id: number }>('getMe', {}, 'бот не отвечает')
      ).id;
    }

    return this.botId;
  }

  // One Bot API call whose failure is the owner's problem to read: Telegram's own reason, in a 400.
  private async call<T>(
    method: string,
    body: Record<string, unknown> | FormData,
    hint?: string,
  ): Promise<T> {
    const response = await this.telegram.request<T>(
      method,
      body,
      body instanceof FormData ? 120_000 : undefined,
    );

    if (response.ok) return response.result;

    throw fail(
      hint ? `${hint} (${response.reason})` : `Telegram: ${response.reason}`,
    );
  }
}
