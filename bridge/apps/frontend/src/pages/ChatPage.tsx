import { useMemo, useState } from 'react';
import { ChatContainer } from '@gravity-ui/aikit';
import type {
  ChatContainerTexts,
  ChatStatus,
  ChatType,
  HeaderMenuItem,
  TChatMessage,
  TSubmitData,
} from '@gravity-ui/aikit';
import { Pencil } from '@gravity-ui/icons';
import { Dialog, Icon, Select, TextInput } from '@gravity-ui/uikit';

import { useIsMobile } from '../shared/lib/useIsMobile';
import {
  ChatMessageMeta,
  ChatMeta,
  ChatModelId,
  useCreateChatMutation,
  useDeleteChatMutation,
  useListChatsQuery,
  useListMessagesQuery,
  useRenameChatMutation,
  useSendMessageMutation,
} from '../store/api';
import { PageHeader } from '../widgets/PageHeader';
import styles from './ChatPage.module.css';

const MESSAGES_POLL_INTERVAL_MS = 2000;

// AIKit's own defaults are English, unlabeled-enough to be untestable by
// accessible name, and don't match the rest of bridge's Russian UI — this
// is both an i18n fix and what gives the header/submit buttons real
// accessible names.
const CHAT_TEXTS: ChatContainerTexts = {
  headerNewChatTooltip: 'Новый чат',
  headerHistoryTooltip: 'История',
  headerCloseTooltip: 'Закрыть',
  promptPlaceholder: 'Напишите сообщение…',
  submitSendTooltip: 'Отправить',
  submitCancelTooltip: 'Остановить',
  emptyStateTitle: 'Новый диалог',
  emptyStateDescription: 'Задайте вопрос модели ниже — чат создастся автоматически.',
  historySearchPlaceholder: 'Поиск по чатам',
  historyEmptyPlaceholder: 'Чатов пока нет',
  disclaimerText: 'Модель может ошибаться — проверяйте важные факты.',
};

const MODEL_OPTIONS: { value: ChatModelId; content: string }[] = [
  { value: 'sonnet', content: 'Claude Sonnet' },
  { value: 'opus', content: 'Claude Opus' },
  { value: 'gpt', content: 'GPT' },
  { value: 'deepseek', content: 'DeepSeek' },
  { value: 'qwen', content: 'Qwen' },
];

function modelLabel(model: ChatModelId): string {
  return MODEL_OPTIONS.find((option) => option.value === model)?.content ?? model;
}

function toChatType(chat: ChatMeta): ChatType {
  return {
    id: String(chat.id),
    name: chat.title ?? `${modelLabel(chat.model)} · #${chat.id}`,
    createTime: chat.createdAt,
  };
}

// 'pending'/'running' render as an empty bubble — the container's own
// `status` prop (not per-message state) is what drives the "thinking"
// indicator while that's the case. A failed turn renders its error inline
// instead of using AIKit's single top-level error/onRetry (this chat can
// in principle have more than one non-complete message at a time, which a
// single container-level error slot doesn't model well).
function toChatMessage(message: ChatMessageMeta): TChatMessage {
  const id = String(message.id);
  const timestamp = message.createdAt;

  if (message.role === 'user') {
    return { role: 'user', id, timestamp, content: message.content };
  }

  const content = message.status === 'failed'
    ? `⚠️ ${message.errorMessage ?? 'Не удалось получить ответ'}`
    : message.content;

  return { role: 'assistant', id, timestamp, content };
}

export function ChatPage() {
  const isMobile = useIsMobile();
  const { data: chatsData } = useListChatsQuery();
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const { data: messagesData } = useListMessagesQuery(activeChatId ?? 0, {
    skip: activeChatId === null,
    pollingInterval: MESSAGES_POLL_INTERVAL_MS,
  });

  const [createChat] = useCreateChatMutation();
  const [deleteChat] = useDeleteChatMutation();
  const [renameChat] = useRenameChatMutation();
  const [sendMessage] = useSendMessageMutation();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newChatModel, setNewChatModel] = useState<ChatModelId>('sonnet');
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const chats = useMemo(() => (chatsData ?? []).map(toChatType), [chatsData]);
  const activeChat = chats.find((chat) => chat.id === String(activeChatId)) ?? null;
  const messages = useMemo(() => (messagesData ?? []).map(toChatMessage), [messagesData]);

  const hasPendingReply = (messagesData ?? []).some(
    (message) => message.status === 'pending' || message.status === 'running',
  );
  const status: ChatStatus = hasPendingReply ? 'submitted' : 'ready';

  // The composer is visible and enabled even with no chat selected yet
  // (AIKit's own welcome/empty state) — typing and sending there implicitly
  // starts a new chat with whatever model is currently picked, rather than
  // silently doing nothing until the user finds the explicit "Новый чат"
  // dialog first.
  const handleSendMessage = async (data: TSubmitData) => {
    let chatId = activeChatId;

    if (chatId === null) {
      const chat = await createChat({ model: newChatModel }).unwrap();
      chatId = chat.id;
      setActiveChatId(chatId);
    }

    await sendMessage({ chatId, content: data.content }).unwrap();
  };

  const handleCreateChat = async () => {
    setIsCreateDialogOpen(false);
    const chat = await createChat({ model: newChatModel }).unwrap();
    setActiveChatId(chat.id);
  };

  const handleDeleteChat = async (chat: ChatType) => {
    const id = Number(chat.id);
    await deleteChat(id).unwrap();
    if (activeChatId === id) setActiveChatId(null);
  };

  const handleOpenRenameDialog = () => {
    if (!activeChat) return;
    setRenameValue(activeChat.name);
    setIsRenameDialogOpen(true);
  };

  const handleRenameChat = async () => {
    const title = renameValue.trim();
    if (activeChatId === null || !title) return;
    setIsRenameDialogOpen(false);
    await renameChat({ id: activeChatId, title }).unwrap();
  };

  // Only offered once a chat exists — renaming the "no chat selected" state
  // makes no sense, same reasoning as NewChat's header-action gating.
  const headerMenuItems: HeaderMenuItem[] | undefined = activeChat
    ? [
        {
          id: 'rename',
          label: 'Переименовать',
          icon: <Icon data={Pencil} size={16} />,
          onClick: handleOpenRenameDialog,
        },
      ]
    : undefined;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Chat"
        description="Диалог с моделью (Claude, GPT, DeepSeek, Qwen) через worker — без посылки и без редактирования файлов."
      />

      <div className={styles.container}>
        <ChatContainer
          chats={chats}
          activeChat={activeChat}
          messages={messages}
          status={status}
          isMobile={isMobile}
          texts={CHAT_TEXTS}
          onSendMessage={handleSendMessage}
          onSelectChat={(chat) => setActiveChatId(Number(chat.id))}
          onCreateChat={() => setIsCreateDialogOpen(true)}
          onDeleteChat={handleDeleteChat}
          headerProps={{ menuItems: headerMenuItems }}
        />
      </div>

      <Dialog open={isCreateDialogOpen} onClose={() => setIsCreateDialogOpen(false)} maxWidth="s">
        <Dialog.Header caption="Новый чат" />
        <Dialog.Body>
          <Select
            value={[newChatModel]}
            onUpdate={([value]) => setNewChatModel(value as ChatModelId)}
            options={MODEL_OPTIONS}
            width="max"
          />
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Создать"
          onClickButtonCancel={() => setIsCreateDialogOpen(false)}
          onClickButtonApply={() => void handleCreateChat()}
        />
      </Dialog>

      <Dialog open={isRenameDialogOpen} onClose={() => setIsRenameDialogOpen(false)} maxWidth="s">
        <Dialog.Header caption="Переименовать чат" />
        <Dialog.Body>
          <TextInput
            value={renameValue}
            onUpdate={setRenameValue}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleRenameChat();
            }}
          />
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Сохранить"
          propsButtonApply={{ disabled: !renameValue.trim() }}
          onClickButtonCancel={() => setIsRenameDialogOpen(false)}
          onClickButtonApply={() => void handleRenameChat()}
        />
      </Dialog>
    </div>
  );
}
