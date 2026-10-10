import { useEffect, useMemo, useState } from 'react';
import { ChatContainer } from '@gravity-ui/aikit';
import type {
  ChatContainerTexts,
  ChatStatus,
  ChatType,
  HeaderMenuItem,
  TChatMessage,
  TSubmitData,
} from '@gravity-ui/aikit';
import { BookOpen, Pencil } from '@gravity-ui/icons';
import { Alert, Dialog, Icon, Select, TextInput } from '@gravity-ui/uikit';

import { useIsMobile } from '../shared/lib/useIsMobile';
import { useAppSelector } from '../store/hooks';
import {
  ChatAttachmentMeta,
  ChatMessageMeta,
  ChatMeta,
  ChatModelId,
  useCreateChatMutation,
  useDeleteChatMutation,
  useListChatsQuery,
  useListMessagesQuery,
  useRenameChatMutation,
  MAX_ATTACHMENTS_PER_MESSAGE,
  useSendMessageMutation,
} from '../store/api';
import { PageHeader } from '../widgets/PageHeader';
import { AttachButton } from './chat/AttachButton';
import { attachmentProblem, deleteChatAttachment, isClaudeModel, uploadChatAttachment } from './chat/chatAttachments';
import { buildContextDraft, ContextDraft } from './chat/chatContext';
import { SaveToContextDialog } from './chat/SaveToContextDialog';
import { useAttachmentUrls } from './chat/useAttachmentUrls';
import styles from './ChatPage.module.css';

// Fast while a reply is on its way, off otherwise — an idle chat has nothing to fetch.
const MESSAGES_POLL_INTERVAL_MS = 2000;
const NO_REPLY_PENDING_POLL_MS = 0;

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
function toChatMessage(message: ChatMessageMeta, imageUrls: Record<number, string>): TChatMessage {
  const id = String(message.id);
  const timestamp = message.createdAt;

  if (message.role === 'user') {
    const attachments = message.attachments ?? [];
    const images = attachments.flatMap((attachment) => (attachment.isImage && imageUrls[attachment.id] ? [imageUrls[attachment.id]] : []));
    const files = attachments.filter((attachment) => !attachment.isImage).map((attachment) => ({ id: String(attachment.id), name: attachment.name }));

    // Assistant replies render as markdown unconditionally (AIKit has no
    // off switch for that side) — matching it here means a user's own
    // pasted code block or list renders instead of showing raw `*`/backticks.
    return {
      role: 'user',
      id,
      timestamp,
      content: message.content,
      format: 'markdown',
      ...(images.length > 0 ? { images } : {}),
      ...(files.length > 0 ? { fileAttachments: files } : {}),
    };
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
  const [pollingInterval, setPollingInterval] = useState(MESSAGES_POLL_INTERVAL_MS);
  const { data: messagesData } = useListMessagesQuery(activeChatId ?? 0, {
    skip: activeChatId === null,
    pollingInterval,
    skipPollingIfUnfocused: true,
  });
  const accessToken = useAppSelector((state) => state.auth.accessToken);

  const [createChat, { isLoading: isCreatingChat }] = useCreateChatMutation();
  const [deleteChat] = useDeleteChatMutation();
  const [renameChat, { isLoading: isRenamingChat }] = useRenameChatMutation();
  const [sendMessage] = useSendMessageMutation();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newChatModel, setNewChatModel] = useState<ChatModelId>('sonnet');
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const chats = useMemo(() => (chatsData ?? []).map(toChatType), [chatsData]);
  const activeChat = chats.find((chat) => chat.id === String(activeChatId)) ?? null;
  const imageUrls = useAttachmentUrls(messagesData ?? [], accessToken);
  const messages = useMemo(() => (messagesData ?? []).map((message) => toChatMessage(message, imageUrls)), [messagesData, imageUrls]);

  const hasPendingReply = (messagesData ?? []).some(
    (message) => message.status === 'pending' || message.status === 'running',
  );
  const status: ChatStatus = hasPendingReply ? 'submitted' : 'ready';

  useEffect(() => {
    setPollingInterval(hasPendingReply ? MESSAGES_POLL_INTERVAL_MS : NO_REPLY_PENDING_POLL_MS);
  }, [hasPendingReply]);

  // Files uploaded for the message being written; they travel with it when it is sent.
  const [pendingFiles, setPendingFiles] = useState<ChatAttachmentMeta[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [contextDraft, setContextDraft] = useState<ContextDraft | null>(null);

  // The composer is visible and enabled even with no chat selected yet
  // (AIKit's own welcome/empty state) — typing and sending there implicitly
  // starts a new chat with whatever model is currently picked, rather than
  // silently doing nothing until the user finds the explicit "Новый чат"
  // dialog first. That "currently picked" model has to be visible and
  // changeable right there in the composer, not just inside the separate
  // dialog — otherwise the first message of every implicit chat silently
  // goes to sonnet with no way to tell or change that in advance.
  const activeModel: ChatModelId = chatsData?.find((chat) => chat.id === activeChatId)?.model ?? newChatModel;
  const canAttach = isClaudeModel(activeModel);

  // The chat must exist before a file can be uploaded to it, so attaching in the empty state
  // starts the chat (with the model currently picked) just as sending would.
  const ensureChat = async (): Promise<number> => {
    if (activeChatId !== null) return activeChatId;

    const chat = await createChat({ model: newChatModel }).unwrap();
    setActiveChatId(chat.id);

    return chat.id;
  };

  const handleAttachFiles = async (files: File[]) => {
    setChatError(null);

    const room = MAX_ATTACHMENTS_PER_MESSAGE - pendingFiles.length;
    const chosen = files.slice(0, Math.max(room, 0));
    const problems: string[] = files.length > chosen.length ? [`К сообщению можно прикрепить не больше ${MAX_ATTACHMENTS_PER_MESSAGE} файлов`] : [];

    setIsUploading(true);

    try {
      const chatId = await ensureChat();

      for (const file of chosen) {
        const problem = attachmentProblem(file);

        if (problem) {
          problems.push(problem);
          continue;
        }

        try {
          const uploaded = await uploadChatAttachment(chatId, file, accessToken);

          setPendingFiles((current) => [...current, uploaded]);
        } catch (error) {
          problems.push(error instanceof Error ? error.message : `Не удалось загрузить «${file.name}»`);
        }
      }
    } catch {
      problems.push('Не удалось создать чат');
    } finally {
      setIsUploading(false);
    }

    if (problems.length > 0) setChatError(problems.join('\n'));
  };

  const handleRemovePending = (attachment: ChatAttachmentMeta) => {
    setPendingFiles((current) => current.filter((file) => file.id !== attachment.id));
    void deleteChatAttachment(attachment.id, accessToken);
  };

  const handleSendMessage = async (data: TSubmitData) => {
    setChatError(null);

    try {
      const chatId = await ensureChat();

      await sendMessage({ chatId, content: data.content, attachmentIds: pendingFiles.map((file) => file.id) }).unwrap();
      setPendingFiles([]);
    } catch (error) {
      // The draft stays attached: the user can send again once whatever failed is sorted out.
      setChatError(typeof error === 'string' ? error : 'Не удалось отправить сообщение — попробуйте ещё раз');
    }
  };

  const handleSaveToContext = () => {
    const chat = chatsData?.find((entry) => entry.id === activeChatId);

    setContextDraft(buildContextDraft(chat?.title ?? activeChat?.name ?? 'Чат', messagesData ?? [], modelLabel(activeModel)));
  };

  // Dialogs close only once their request succeeds, so a failure leaves the user's input in place.
  const handleCreateChat = async () => {
    if (isCreatingChat) return;
    setChatError(null);

    try {
      const chat = await createChat({ model: newChatModel }).unwrap();

      setIsCreateDialogOpen(false);
      setActiveChatId(chat.id);
      setPendingFiles([]);
    } catch {
      setChatError('Не удалось создать чат');
    }
  };

  const handleDeleteChat = async (chat: ChatType) => {
    const id = Number(chat.id);
    setChatError(null);

    try {
      await deleteChat(id).unwrap();
    } catch {
      setChatError('Не удалось удалить чат');
      return;
    }

    if (activeChatId === id) {
      setActiveChatId(null);
      setPendingFiles([]);
    }
  };

  const handleOpenRenameDialog = () => {
    if (!activeChat) return;
    setRenameValue(activeChat.name);
    setIsRenameDialogOpen(true);
  };

  const handleRenameChat = async () => {
    const title = renameValue.trim();
    if (activeChatId === null || !title || isRenamingChat) return;
    setChatError(null);

    try {
      await renameChat({ id: activeChatId, title }).unwrap();
      setIsRenameDialogOpen(false);
    } catch {
      setChatError('Не удалось переименовать чат');
    }
  };

  // Lets the user see/change which model their first message will go to
  // before a chat exists. Once a chat is active its model is already fixed,
  // so the picker disappears rather than implying it could still be changed.
  const attachButton = (
    <AttachButton
      disabled={!canAttach || isUploading || pendingFiles.length >= MAX_ATTACHMENTS_PER_MESSAGE}
      disabledReason={canAttach ? `Не больше ${MAX_ATTACHMENTS_PER_MESSAGE} файлов в сообщении` : 'Вложения доступны в чатах с Claude (Sonnet, Opus)'}
      onFiles={(files) => void handleAttachFiles(files)}
    />
  );

  // AIKit drops its own attachment slot whenever a custom footer is given, so before a chat
  // exists the paperclip sits beside the model picker in that custom footer instead.
  const footerModelPicker = !activeChat ? (
    <div className={styles.modelPicker}>
      {attachButton}
      <span className={styles.modelPickerLabel}>Модель:</span>
      <Select
        size="s"
        value={[newChatModel]}
        onUpdate={([value]) => setNewChatModel(value as ChatModelId)}
        options={MODEL_OPTIONS}
        width={150}
      />
    </div>
  ) : undefined;

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
        {
          id: 'save-to-context',
          label: 'Сохранить в Context',
          icon: <Icon data={BookOpen} size={16} />,
          onClick: handleSaveToContext,
        },
      ]
    : undefined;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Chat"
        description="Диалог с моделью (Claude, GPT, DeepSeek, Qwen) через worker. В чатах с Claude можно прикреплять изображения и файлы, а весь диалог — сохранить в Context."
      />

      {chatError && (
        <Alert theme="danger" view="filled" message={<span className={styles.errorText}>{chatError}</span>} onClose={() => setChatError(null)} />
      )}

      <div className={styles.container}>
        <ChatContainer
          chats={chats}
          activeChat={activeChat}
          messages={messages}
          status={status}
          isMobile={isMobile}
          texts={CHAT_TEXTS}
          onSendMessage={handleSendMessage}
          onSelectChat={(chat) => {
            setActiveChatId(Number(chat.id));
            setPendingFiles([]);
            setChatError(null);
          }}
          onCreateChat={() => setIsCreateDialogOpen(true)}
          onDeleteChat={handleDeleteChat}
          headerProps={{ menuItems: headerMenuItems }}
          // The files waiting to be sent, as chips in the composer; clicking one takes it back.
          contextItems={pendingFiles.map((file) => ({ id: String(file.id), content: file.name, onRemove: () => handleRemovePending(file) }))}
          promptInputProps={{
            view: 'full',
            footerProps: {
              bottomContent: footerModelPicker,
              attachmentContent: attachButton,
            },
          }}
        />
      </div>

      {contextDraft && <SaveToContextDialog draft={contextDraft} onClose={() => setContextDraft(null)} />}

      <Dialog open={isCreateDialogOpen} onClose={() => setIsCreateDialogOpen(false)} maxWidth="s">
        <Dialog.Header caption="Новый чат" />
        <Dialog.Body>
          <Select
            aria-label="Модель"
            value={[newChatModel]}
            onUpdate={([value]) => setNewChatModel(value as ChatModelId)}
            options={MODEL_OPTIONS}
            width="max"
          />
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Создать"
          propsButtonApply={{ loading: isCreatingChat, disabled: isCreatingChat }}
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
            controlProps={{ 'aria-label': 'Название чата' }}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleRenameChat();
            }}
          />
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Сохранить"
          propsButtonApply={{ loading: isRenamingChat, disabled: !renameValue.trim() || isRenamingChat }}
          onClickButtonCancel={() => setIsRenameDialogOpen(false)}
          onClickButtonApply={() => void handleRenameChat()}
        />
      </Dialog>
    </div>
  );
}
