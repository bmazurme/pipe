import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChatContainer } from '@gravity-ui/aikit';
import type {
  ChatContainerTexts,
  ChatStatus,
  ChatType,
  HeaderMenuItem,
  TChatMessage,
} from '@gravity-ui/aikit';
import { ArrowDownToLine, BookOpen, Paperclip, Pencil } from '@gravity-ui/icons';
import { Alert, Button, Icon, Select, Text, TextInput } from '@gravity-ui/uikit';
import { Dialog } from '../shared/ui/Dialog';

import { triggerBlobDownload } from '../shared/lib/parcelCrypto';
import { useIsMobile } from '../shared/lib/useIsMobile';
import { useAppSelector } from '../store/hooks';
import {
  ChatMessageMeta,
  ChatMeta,
  ChatModelId,
  useDeleteChatMutation,
  useListChatsQuery,
  useListContextsQuery,
  useListMessagesQuery,
  useListProviderCredentialsQuery,
  useRenameChatMutation,
  useUpdateChatModelMutation,
  useRetryChatTurnMutation,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '../store/api';
import { PageHeader } from '../widgets/PageHeader';
import { AttachButton } from './chat/AttachButton';
import { isClaudeModel } from './chat/chatAttachments';
import { extractChatAction } from './chat/chatActions';
import { hasStreamedText, pendingBubbleText } from './chat/chatProgress';
import { MergePrCard } from './chat/MergePrCard';
import { PrFixCard } from './chat/PrFixCard';
import { buildChatMarkdown, buildContextDraft, chatMarkdownFilename, ContextDraft } from './chat/chatContext';
import { AttachRunResultDialog } from './chat/AttachRunResultDialog';
import { SaveToContextDialog } from './chat/SaveToContextDialog';
import { useDebouncedSearch } from './chat/useDebouncedSearch';
import { useChatComposer } from './chat/useChatComposer';
import { useAttachmentUrls } from './chat/useAttachmentUrls';
import styles from './ChatPage.module.css';

// Fast while a reply is on its way, off otherwise — an idle chat has nothing to fetch.
// While a reply is awaited the page asks every second: the worker reports the partial reply about as often, so it reads as streaming.
const NO_CONTEXT = 'none';

const MESSAGES_POLL_INTERVAL_MS = 1000;
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
  { value: 'haiku', content: 'Claude Haiku' },
  { value: 'gpt', content: 'GPT' },
  { value: 'deepseek', content: 'DeepSeek' },
  { value: 'qwen', content: 'Qwen' },
  { value: 'custom', content: 'Другая модель' },
];

function modelLabel(model: ChatModelId): string {
  return MODEL_OPTIONS.find((option) => option.value === model)?.content ?? model;
}

// History groups and orders chats by this date — the last activity, matching the server's own
// "most recently active first" order, so a chat continued today sits under «Сегодня».
function toChatType(chat: ChatMeta): ChatType {
  return {
    id: String(chat.id),
    name: chat.title ?? `${modelLabel(chat.model)} · #${chat.id}`,
    createTime: chat.updatedAt,
  };
}

/** The open chat lives in the URL (`?chat=12`), so a reload or a shared link lands on it. */
function useActiveChatParam(): [number | null, (id: number | null) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = Number(searchParams.get('chat'));
  const activeChatId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;

  const setActiveChatId = useCallback(
    (id: number | null) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);

          if (id === null) next.delete('chat');
          else next.set('chat', String(id));

          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [activeChatId, setActiveChatId];
}

// 'pending'/'running' render as an empty bubble — the container's own
// `status` prop (not per-message state) is what drives the "thinking"
// indicator while that's the case. A failed turn renders its error inline
// instead of using AIKit's single top-level error/onRetry (this chat can
// in principle have more than one non-complete message at a time, which a
// single container-level error slot doesn't model well).
function toChatMessage(message: ChatMessageMeta, imageUrls: Record<number, string>, now: number): TChatMessage {
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

  // A reply still being produced shows its progress — the text so far, or how long it has been waited for — instead of an
  // empty bubble next to a loader.
  const content = message.status === 'failed'
    ? `⚠️ ${message.errorMessage ?? 'Не удалось получить ответ'}`
    : message.status === 'pending' || message.status === 'running'
      ? pendingBubbleText(message, now)
      : extractChatAction(message.content).text;

  // A finished Claude reply can carry its reasoning — shown as a collapsed block above the
  // answer, native to AIKit (ThinkingMessageContent), open/closed by its own toggle button.
  // gpt/deepseek/qwen never report one, so this is absent for those chats.
  if (message.status === 'complete' && message.reasoning) {
    return {
      role: 'assistant',
      id,
      timestamp,
      content: [
        { type: 'thinking', data: { content: message.reasoning, status: 'thought', defaultExpanded: false } },
        { type: 'text', data: { text: content } },
      ],
    };
  }

  return { role: 'assistant', id, timestamp, content };
}

export function ChatPage() {
  const isMobile = useIsMobile();
  const [searchText, setSearchText] = useState('');
  const searchQuery = useDebouncedSearch(searchText);
  const { data: chatsData } = useListChatsQuery(searchQuery ? { q: searchQuery } : undefined);
  const [activeChatId, setActiveChatId] = useActiveChatParam();
  const [pollingInterval, setPollingInterval] = useState(MESSAGES_POLL_INTERVAL_MS);
  const { data: messagesData, error: messagesError } = useListMessagesQuery(activeChatId ?? 0, {
    skip: activeChatId === null,
    pollingInterval,
    skipPollingIfUnfocused: true,
  });
  const accessToken = useAppSelector((state) => state.auth.accessToken);

  const [deleteChat, { isLoading: isDeletingChat }] = useDeleteChatMutation();
  const [renameChat, { isLoading: isRenamingChat }] = useRenameChatMutation();
  const [updateChatModel, { isLoading: isChangingModel }] = useUpdateChatModelMutation();

  const [chatToDelete, setChatToDelete] = useState<ChatType | null>(null);
  const [newChatModel, setNewChatModel] = useState<ChatModelId>('sonnet');
  // Like the model, fixed once the chat exists; never remembered between chats.
  const [newChatContextId, setNewChatContextId] = useState<number | undefined>(undefined);
  const { data: contextsData } = useListContextsQuery();
  // A custom chat runs on the server of one stored key; picked here, first one by default.
  const [newChatKeyId, setNewChatKeyId] = useState<number | undefined>(undefined);
  const { data: providerKeys } = useListProviderCredentialsQuery();
  const customKeys = (Array.isArray(providerKeys) ? providerKeys : []).filter((key) => key.provider === 'custom');
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const chats = useMemo(() => (chatsData ?? []).map(toChatType), [chatsData]);
  // A search can hide the open chat from the list; keep showing it rather than blanking the conversation.
  const lastActiveChat = useRef<ChatType | null>(null);
  const activeChat =
    chats.find((chat) => chat.id === String(activeChatId)) ??
    (lastActiveChat.current?.id === String(activeChatId) ? lastActiveChat.current : null);
  lastActiveChat.current = activeChat;
  const imageUrls = useAttachmentUrls(messagesData ?? [], accessToken);
  // Ticks once a second while a reply is awaited, so the waiting time on its bubble visibly counts.
  const [now, setNow] = useState(() => Date.now());
  // Finished messages are converted once and keep their identity from tick to tick (and across polls that did not
  // change them); only a pending/running reply is rebuilt with `now`.
  const convertedCache = useRef(new Map<string, { source: ChatMessageMeta; imageUrls: Record<number, string>; converted: TChatMessage }>());
  const messages = useMemo(() => {
    const cache = convertedCache.current;
    const seen = new Set<string>();
    const result = (messagesData ?? []).map((message) => {
      if (message.status === 'pending' || message.status === 'running') return toChatMessage(message, imageUrls, now);

      const key = String(message.id);
      const cached = cache.get(key);

      seen.add(key);
      if (cached && cached.source === message && cached.imageUrls === imageUrls) return cached.converted;

      const converted = toChatMessage(message, imageUrls, now);

      cache.set(key, { source: message, imageUrls, converted });

      return converted;
    });

    for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);

    return result;
  }, [messagesData, imageUrls, now]);

  // The model's proposal to change a pull request, from its latest finished reply — offered as a card to
  // confirm, once; the person's decision is remembered per message.
  const [decidedActions, setDecidedActions] = useState<ReadonlySet<number>>(new Set());
  const lastReply = [...(messagesData ?? [])].reverse().find((message) => message.role === 'assistant');
  const proposal =
    lastReply && lastReply.status === 'complete' && !decidedActions.has(lastReply.id)
      ? extractChatAction(lastReply.content).action
      : null;

  const [retryChatTurn, { isLoading: isRetrying }] = useRetryChatTurnMutation();
  const newestMessage = (messagesData ?? [])[(messagesData ?? []).length - 1];
  const failedLastReply = newestMessage && newestMessage.role === 'assistant' && newestMessage.status === 'failed' ? newestMessage : null;

  const handleRetry = async (message: ChatMessageMeta) => {
    composer.setChatError(null);

    try {
      await retryChatTurn({ chatId: message.chatId, messageId: message.id }).unwrap();
    } catch {
      composer.setChatError('Не удалось повторить ответ');
    }
  };

  const hasPendingReply = (messagesData ?? []).some(
    (message) => message.status === 'pending' || message.status === 'running',
  );
  const isStreaming = (messagesData ?? []).some((message) => hasStreamedText(message));
  // Waiting is 'streaming_loading', not 'submitted': AIKit locks the prompt for 'submitted', and a worker can take
  // minutes — the next message can be written meanwhile (and is queued if sent before the reply is in).
  const status: ChatStatus = isStreaming ? 'streaming' : hasPendingReply ? 'streaming_loading' : 'ready';

  // A chat link that no longer leads anywhere (deleted, or someone else's) falls back to the empty composer.
  useEffect(() => {
    if (messagesError && 'status' in messagesError && messagesError.status === 404) setActiveChatId(null);
  }, [messagesError, setActiveChatId]);

  useEffect(() => {
    if (!hasPendingReply) return undefined;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [hasPendingReply]);

  useEffect(() => {
    setPollingInterval(hasPendingReply ? MESSAGES_POLL_INTERVAL_MS : NO_REPLY_PENDING_POLL_MS);
  }, [hasPendingReply]);

  const [isAttachRunOpen, setIsAttachRunOpen] = useState(false);
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
  const activeKeyId = chatsData?.find((chat) => chat.id === activeChatId)?.providerCredentialId ?? newChatKeyId ?? customKeys[0]?.id;
  const activeContextName = chatsData?.find((chat) => chat.id === activeChatId)?.contextName ?? null;
  const canAttach = isClaudeModel(activeModel);

  const composer = useChatComposer({
    activeChatId,
    setActiveChatId,
    newChatModel,
    newChatContextId,
    newChatProviderCredentialId: newChatKeyId ?? customKeys[0]?.id,
    hasPendingReply,
    lastReplyStatus: lastReply?.status,
    messagesLoaded: Boolean(messagesData),
    accessToken,
  });

  const handleSaveToContext = () => {
    const chat = chatsData?.find((entry) => entry.id === activeChatId);

    setContextDraft(buildContextDraft(chat?.title ?? activeChat?.name ?? 'Чат', messagesData ?? [], modelLabel(activeModel)));
  };

  const handleDownloadMarkdown = () => {
    if (activeChatId === null) return;
    const chat = chatsData?.find((entry) => entry.id === activeChatId);
    const markdown = buildChatMarkdown(chat?.title ?? activeChat?.name ?? 'Чат', messagesData ?? [], modelLabel(activeModel));

    triggerBlobDownload(new Blob([markdown], { type: 'text/markdown' }), chatMarkdownFilename(chat?.title ?? activeChat?.name, activeChatId));
  };

  // «Новый чат» goes back to the empty composer, where the model is picked; the chat itself is created by the first
  // message (or file), so no empty chats pile up in the history.
  const handleNewChat = () => {
    setActiveChatId(null);
    setNewChatContextId(undefined);
    composer.reset();
  };

  // Deleting a whole conversation is a single click in AIKit's history — it is confirmed first.
  const handleDeleteChat = async (chat: ChatType) => {
    setChatToDelete(chat);
  };

  // Dialogs close only once their request succeeds, so a failure leaves the user's input in place.
  const handleConfirmDelete = async () => {
    if (!chatToDelete || isDeletingChat) return;
    const id = Number(chatToDelete.id);
    composer.setChatError(null);

    try {
      await deleteChat(id).unwrap();
    } catch {
      composer.setChatError('Не удалось удалить чат');
      return;
    } finally {
      setChatToDelete(null);
    }

    if (activeChatId === id) {
      setActiveChatId(null);
    }
    composer.dropChat(id);
  };

  const handleOpenRenameDialog = () => {
    if (!activeChat) return;
    setRenameValue(activeChat.name);
    setIsRenameDialogOpen(true);
  };

  const handleRenameChat = async () => {
    const title = renameValue.trim();
    if (activeChatId === null || !title || isRenamingChat) return;
    composer.setChatError(null);

    try {
      await renameChat({ id: activeChatId, title }).unwrap();
      setIsRenameDialogOpen(false);
    } catch {
      composer.setChatError('Не удалось переименовать чат');
    }
  };

  const handleChangeModel = async (model: ChatModelId, providerCredentialId?: number) => {
    if (activeChatId === null || (model === activeModel && providerCredentialId === undefined) || isChangingModel) return;
    composer.setChatError(null);

    try {
      await updateChatModel({
        id: activeChatId,
        model,
        ...(model === 'custom' ? { providerCredentialId: providerCredentialId ?? customKeys[0]?.id } : {}),
      }).unwrap();
    } catch (error) {
      const message = (error as { data?: { message?: unknown } })?.data?.message;
      composer.setChatError(typeof message === 'string' ? message : 'Не удалось сменить модель');
    }
  };

  const attachButton = (
    <AttachButton
      disabled={!canAttach || composer.isUploading || composer.pendingFiles.length >= MAX_ATTACHMENTS_PER_MESSAGE}
      disabledReason={canAttach ? `Не больше ${MAX_ATTACHMENTS_PER_MESSAGE} файлов в сообщении` : 'Вложения доступны в чатах с Claude (Sonnet, Opus, Haiku)'}
      onFiles={(files) => void composer.attachFiles(files)}
    />
  );

  // AIKit drops its own attachment slot whenever a custom footer is given, so the paperclip sits in it, beside the model.
  // The model can be picked here before a chat exists and switched in an active one (not while a reply is pending);
  // the paperclip is off in a GPT/DeepSeek/Qwen chat.
  const composerFooter = (
    <div className={styles.modelPicker}>
      {attachButton}
      <span className={styles.modelPickerLabel}>Модель:</span>
      <Select
        size="s"
        aria-label="Модель"
        value={[activeModel]}
        onUpdate={([value]) => {
          if (activeChat) void handleChangeModel(value as ChatModelId);
          else setNewChatModel(value as ChatModelId);
        }}
        options={MODEL_OPTIONS}
        disabled={Boolean(activeChat) && (hasPendingReply || isChangingModel)}
        width={150}
      />
      {activeModel === 'custom' &&
        (customKeys.length > 0 ? (
          <Select
            size="s"
            aria-label="Ключ модели"
            value={activeKeyId === undefined ? [] : [String(activeKeyId)]}
            onUpdate={([value]) => {
              if (!value) return;
              if (activeChat) void handleChangeModel('custom', Number(value));
              else setNewChatKeyId(Number(value));
            }}
            options={customKeys.map((key) => ({ value: String(key.id), content: `${key.name}${key.model ? ` · ${key.model}` : ''}` }))}
            disabled={Boolean(activeChat) && (hasPendingReply || isChangingModel)}
            width={190}
          />
        ) : (
          <Link to="/worker?tab=keys">Добавить ключ модели</Link>
        ))}
      {activeChat ? (
        activeContextName && (
          <>
            <span className={styles.modelPickerLabel}>Контекст:</span>
            <span className={styles.modelName}>{activeContextName}</span>
          </>
        )
      ) : (
        <>
          <span className={styles.modelPickerLabel}>Контекст:</span>
          <Select
            size="s"
            aria-label="Контекст"
            value={[newChatContextId ? String(newChatContextId) : NO_CONTEXT]}
            onUpdate={([value]) => setNewChatContextId(value && value !== NO_CONTEXT ? Number(value) : undefined)}
            options={[
              { value: NO_CONTEXT, content: 'Без контекста' },
              ...(contextsData ?? []).map((context) => ({ value: String(context.id), content: context.name })),
            ]}
            width={170}
          />
        </>
      )}
    </div>
  );

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
          id: 'attach-run-result',
          label: 'Прикрепить результат задачи',
          icon: <Icon data={Paperclip} size={16} />,
          onClick: () => setIsAttachRunOpen(true),
        },
        {
          id: 'save-to-context',
          label: 'Сохранить в Context',
          icon: <Icon data={BookOpen} size={16} />,
          onClick: handleSaveToContext,
        },
        {
          id: 'download-markdown',
          label: 'Скачать как Markdown',
          icon: <Icon data={ArrowDownToLine} size={16} />,
          onClick: handleDownloadMarkdown,
        },
      ]
    : undefined;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Chat"
        description="Диалог с моделью (Claude, GPT, DeepSeek, Qwen) через worker. В чатах с Claude можно прикреплять изображения и файлы, а весь диалог — сохранить в Context."
      />

      {composer.chatError && (
        <Alert
          theme="danger"
          view="filled"
          message={
            <span className={styles.errorText}>
              {composer.chatError}
              {composer.failedDraft && <span className={styles.draftPreview}>«{composer.failedDraft}»</span>}
            </span>
          }
          actions={
            composer.failedDraft ? (
              <div className={styles.alertActions}>
                <Button view="normal" size="s" onClick={composer.resend} disabled={hasPendingReply}>
                  Отправить ещё раз
                </Button>
                <Button view="flat" size="s" onClick={composer.copyDraft}>
                  Скопировать текст
                </Button>
              </div>
            ) : undefined
          }
          onClose={composer.dismissError}
        />
      )}

      {proposal && lastReply && activeChatId !== null && proposal.type === 'fix-pr' && (
        <PrFixCard
          key={lastReply.id}
          action={proposal}
          model={activeModel}
          onDone={() => setDecidedActions((previous) => new Set(previous).add(lastReply.id))}
        />
      )}

      {proposal && lastReply && activeChatId !== null && proposal.type === 'merge-pr' && (
        <MergePrCard
          key={lastReply.id}
          action={proposal}
          onDone={() => setDecidedActions((previous) => new Set(previous).add(lastReply.id))}
        />
      )}

      <div className={styles.search}>
        <TextInput
          value={searchText}
          onUpdate={setSearchText}
          placeholder="Поиск по чатам и сообщениям"
          hasClear
          controlProps={{ 'aria-label': 'Поиск по чатам' }}
        />
        {searchQuery && chats.length === 0 && (
          <Text variant="caption-2" color="secondary">
            Ничего не найдено
          </Text>
        )}
      </div>

      <div className={styles.container}>
        <ChatContainer
          chats={chats}
          activeChat={activeChat}
          messages={messages}
          status={status}
          isMobile={isMobile}
          texts={CHAT_TEXTS}
          onSendMessage={composer.send}
          onSelectChat={(chat) => {
            setActiveChatId(Number(chat.id));
            composer.reset();
          }}
          onCreateChat={handleNewChat}
          onDeleteChat={handleDeleteChat}
          headerProps={{ menuItems: headerMenuItems }}
          // The files waiting to be sent, as chips in the composer; clicking one takes it back.
          contextItems={composer.pendingFiles.map((file) => ({ id: String(file.id), content: file.name, onRemove: () => composer.removePending(file) }))}
          promptInputProps={{
            view: 'full',
            footerProps: { bottomContent: composerFooter },
            topPanel: {
              isOpen: composer.queued !== null && composer.queued.chatId === activeChatId,
              children: composer.queued && (
                <div className={styles.queued} role="status">
                  <Text variant="caption-2" color="secondary" ellipsis className={styles.queuedText}>
                    Отправится, когда придёт ответ: «{composer.queued.content}»
                    {composer.queued.files.length > 0 ? ` + файлов: ${composer.queued.files.length}` : ''}
                  </Text>
                  <Button view="flat-secondary" size="xs" onClick={composer.unqueue}>
                    Не отправлять
                  </Button>
                </div>
              ),
            },
          }}
        />
      </div>

      {failedLastReply && activeChatId !== null && (
        <div className={styles.retryRow}>
          <Button view="outlined" size="s" onClick={() => void handleRetry(failedLastReply)} disabled={isRetrying} loading={isRetrying}>
            Повторить
          </Button>
        </div>
      )}

      {isAttachRunOpen && activeChatId !== null && <AttachRunResultDialog chatId={activeChatId} onClose={() => setIsAttachRunOpen(false)} />}
      {contextDraft && <SaveToContextDialog draft={contextDraft} onClose={() => setContextDraft(null)} />}

      <Dialog open={chatToDelete !== null} onClose={() => setChatToDelete(null)} maxWidth="s">
        <Dialog.Header caption="Удалить чат?" />
        <Dialog.Body>
          «{chatToDelete?.name}» и все его сообщения будут удалены без возможности восстановления.
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Удалить"
          propsButtonApply={{ view: 'outlined-danger', loading: isDeletingChat, disabled: isDeletingChat }}
          onClickButtonCancel={() => setChatToDelete(null)}
          onClickButtonApply={() => void handleConfirmDelete()}
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
