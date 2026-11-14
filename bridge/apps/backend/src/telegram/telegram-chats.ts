// The part of a Telegram update that says which chat it is about. Only what the promo bindings need.
export interface TelegramChatInfo {
  id?: number;
  type?: string;
  title?: string;
  username?: string;
}

export interface ObservedUpdate {
  message?: { chat?: TelegramChatInfo };
  channel_post?: { chat?: TelegramChatInfo };
  my_chat_member?: {
    chat?: TelegramChatInfo;
    new_chat_member?: { status?: string };
  };
}

export interface ObservedChat {
  chatId: string;
  type: 'channel' | 'supergroup' | 'group';
  title: string | null;
  username: string | null;
  // Set only when the update itself carries it (my_chat_member); otherwise whatever is already known stays.
  botStatus: string | null;
}

const TYPES = ['channel', 'supergroup', 'group'];

// Which chat (if it is one the promo module cares about) an update came from. Private chats are never recorded.
export function chatFromUpdate(update: ObservedUpdate): ObservedChat | null {
  const member = update.my_chat_member;
  const chat =
    member?.chat ?? update.channel_post?.chat ?? update.message?.chat;

  if (chat?.id === undefined || !chat.type || !TYPES.includes(chat.type)) {
    return null;
  }

  return {
    chatId: String(chat.id),
    type: chat.type as ObservedChat['type'],
    title: chat.title ?? null,
    username: chat.username ?? null,
    botStatus: member?.new_chat_member?.status ?? null,
  };
}
