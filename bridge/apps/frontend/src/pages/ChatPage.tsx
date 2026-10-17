import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChatContainer } from '@gravity-ui/aikit';
import type {
  ChatContainerTexts,
  ChatStatus,
  ChatType,
  HeaderMenuItem,
  TChatMessage,
  TSubmitData,
} from '@gravity-ui/aikit';
import { ArrowDownToLine, BookOpen, Pencil } from '@gravity-ui/icons';
import { Alert, Button, Dialog, Icon, Select, Text, TextInput } from '@gravity-ui/uikit';

import { triggerBlobDownload } from '../shared/lib/parcelCrypto';
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
  useListContextsQuery,
  useListMessagesQuery,
  useRenameChatMutation,
  MAX_ATTACHMENTS_PER_MESSAGE,
  useSendMessageMutation,
} from '../store/api';
import { PageHeader } from '../widgets/PageHeader';
import { AttachButton } from './chat/AttachButton';
import { attachmentProblem, deleteChatAttachment, isClaudeModel, uploadChatAttachment } from './chat/chatAttachments';
import { extractChatAction } from './chat/chatActions';
import { hasStreamedText, pendingBubbleText } from './chat/chatProgress';
import { MergePrCard } from './chat/MergePrCard';
import { PrFixCard } from './chat/PrFixCard';
import { buildChatMarkdown, buildContextDraft, chatMarkdownFilename, ContextDraft } from './chat/chatContext';
import { SaveToContextDialog } from './chat/SaveToContextDialog';
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
  { value: 'gpt', content: 'GPT' },
  { value: 'deepseek', content: 'DeepSeek' },
  { value: 'qwen', content: 'Qwen' },
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

// A message written while the previous reply is still on its way: it goes out on its own once that reply is in.
interface QueuedMessage {
  chatId: number;
  content: string;
  files: ChatAttachmentMeta[];
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

  return { role: 'assistant', id, timestamp, content };
}

export function ChatPage() {
  const isMobile = useIsMobile();
  const { data: chatsData } = useListChatsQuery();
  const [activeChatId, setActiveChatId] = useActiveChatParam();
  const [pollingInterval, setPollingInterval] = useState(MESSAGES_POLL_INTERVAL_MS);
  const { data: messagesData, error: messagesError } = useListMessagesQuery(activeChatId ?? 0, {
    skip: activeChatId === null,
    pollingInterval,
    skipPollingIfUnfocused: true,
  });
  const accessToken = useAppSelector((state) => state.auth.accessToken);

  const [createChat] = useCreateChatMutation();
  const [deleteChat, { isLoading: isDeletingChat }] = useDeleteChatMutation();
  const [renameChat, { isLoading: isRenamingChat }] = useRenameChatMutation();
  const [sendMessage] = useSendMessageMutation();

  const [chatToDelete, setChatToDelete] = useState<ChatType | null>(null);
  const [newChatModel, setNewChatModel] = useState<ChatModelId>('sonnet');
  // Like the model, fixed once the chat exists; never remembered between chats.
  const [newChatContextId, setNewChatContextId] = useState<number | undefined>(undefined);
  const { data: contextsData } = useListContextsQuery();
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const chats = useMemo(() => (chatsData ?? []).map(toChatType), [chatsData]);
  const activeChat = chats.find((chat) => chat.id === String(activeChatId)) ?? null;
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

  // Files uploaded for the message being written; they travel with it when it is sent.
  const [pendingFiles, setPendingFiles] = useState<ChatAttachmentMeta[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  // The text of a message that could not be sent — AIKit has already cleared the composer, so it is kept here to resend.
  const [failedDraft, setFailedDraft] = useState<string | null>(null);
  const [queued, setQueued] = useState<QueuedMessage | null>(null);
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
  const activeContextName = chatsData?.find((chat) => chat.id === activeChatId)?.contextName ?? null;
  const canAttach = isClaudeModel(activeModel);

  // The chat must exist before a file can be uploaded to it, so attaching in the empty state
  // starts the chat (with the model currently picked) just as sending would.
  const ensureChat = async (): Promise<number> => {
    if (activeChatId !== null) return activeChatId;

    const chat = await createChat({ model: newChatModel, contextId: newChatContextId }).unwrap();
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

  const deliver = async (content: string, files: ChatAttachmentMeta[], chatId?: number) => {
    setChatError(null);
    setFailedDraft(null);

    try {
      const targetChatId = chatId ?? (await ensureChat());

      await sendMessage({ chatId: targetChatId, content, attachmentIds: files.map((file) => file.id) }).unwrap();
      setPendingFiles((current) => current.filter((file) => !files.some((sent) => sent.id === file.id)));
    } catch (error) {
      // Text and files stay: the user can send again once whatever failed is sorted out.
      setPendingFiles((current) => [...current, ...files.filter((file) => !current.some((kept) => kept.id === file.id))]);
      setFailedDraft(content);
      setChatError(typeof error === 'string' ? error : 'Не удалось отправить сообщение');
    }
  };

  const handleSendMessage = async (data: TSubmitData) => {
    if (hasPendingReply && activeChatId !== null) {
      const files = pendingFiles;

      setPendingFiles([]);
      setQueued((current) =>
        current && current.chatId === activeChatId
          ? { ...current, content: `${current.content}\n\n${data.content}`, files: [...current.files, ...files] }
          : { chatId: activeChatId, content: data.content, files },
      );

      return;
    }

    await deliver(data.content, pendingFiles);
  };

  // Sends the queued message once the reply it waited for is in. A failed reply holds it back, so the question is not
  // asked into a broken turn — it comes back as a draft to resend.
  const lastReplyStatus = lastReply?.status;

  useEffect(() => {
    if (!queued || queued.chatId !== activeChatId || hasPendingReply || !messagesData) return;

    setQueued(null);

    if (lastReplyStatus === 'failed') {
      setPendingFiles((current) => [...current, ...queued.files]);
      setFailedDraft(queued.content);
      setChatError('Предыдущий ответ не пришёл, поэтому сообщение не отправлено');

      return;
    }

    void deliver(queued.content, queued.files, queued.chatId);
    // deliver is recreated each render; the effect only has to react to the reply finishing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, activeChatId, hasPendingReply, messagesData, lastReplyStatus]);

  const handleUnqueue = () => {
    if (!queued) return;
    setPendingFiles((current) => [...current, ...queued.files]);
    setFailedDraft(queued.content);
    setQueued(null);
  };

  const handleCopyDraft = () => {
    if (failedDraft) void navigator.clipboard?.writeText(failedDraft).catch(() => undefined);
  };

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
    setPendingFiles([]);
    setChatError(null);
    setFailedDraft(null);
  };

  // Deleting a whole conversation is a single click in AIKit's history — it is confirmed first.
  const handleDeleteChat = async (chat: ChatType) => {
    setChatToDelete(chat);
  };

  // Dialogs close only once their request succeeds, so a failure leaves the user's input in place.
  const handleConfirmDelete = async () => {
    if (!chatToDelete || isDeletingChat) return;
    const id = Number(chatToDelete.id);
    setChatError(null);

    try {
      await deleteChat(id).unwrap();
    } catch {
      setChatError('Не удалось удалить чат');
      return;
    } finally {
      setChatToDelete(null);
    }

    if (activeChatId === id) {
      setActiveChatId(null);
      setPendingFiles([]);
    }
    setQueued((current) => (current?.chatId === id ? null : current));
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

  const attachButton = (
    <AttachButton
      disabled={!canAttach || isUploading || pendingFiles.length >= MAX_ATTACHMENTS_PER_MESSAGE}
      disabledReason={canAttach ? `Не больше ${MAX_ATTACHMENTS_PER_MESSAGE} файлов в сообщении` : 'Вложения доступны в чатах с Claude (Sonnet, Opus)'}
      onFiles={(files) => void handleAttachFiles(files)}
    />
  );

  // AIKit drops its own attachment slot whenever a custom footer is given, so the paperclip sits in it, beside the model.
  // Before a chat exists the model can be picked here; once a chat is active its model is fixed, so it is only named —
  // which also says why the paperclip is off in a GPT/DeepSeek/Qwen chat.
  const composerFooter = (
    <div className={styles.modelPicker}>
      {attachButton}
      <span className={styles.modelPickerLabel}>Модель:</span>
      {activeChat ? (
        <span className={styles.modelName}>{modelLabel(activeModel)}</span>
      ) : (
        <Select
          size="s"
          aria-label="Модель"
          value={[newChatModel]}
          onUpdate={([value]) => setNewChatModel(value as ChatModelId)}
          options={MODEL_OPTIONS}
          width={150}
        />
      )}
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

      {chatError && (
        <Alert
          theme="danger"
          view="filled"
          message={
            <span className={styles.errorText}>
              {chatError}
              {failedDraft && <span className={styles.draftPreview}>«{failedDraft}»</span>}
            </span>
          }
          actions={
            failedDraft ? (
              <div className={styles.alertActions}>
                <Button view="normal" size="s" onClick={() => void deliver(failedDraft, pendingFiles)} disabled={hasPendingReply}>
                  Отправить ещё раз
                </Button>
                <Button view="flat" size="s" onClick={handleCopyDraft}>
                  Скопировать текст
                </Button>
              </div>
            ) : undefined
          }
          onClose={() => {
            setChatError(null);
            setFailedDraft(null);
          }}
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
            setFailedDraft(null);
          }}
          onCreateChat={handleNewChat}
          onDeleteChat={handleDeleteChat}
          headerProps={{ menuItems: headerMenuItems }}
          // The files waiting to be sent, as chips in the composer; clicking one takes it back.
          contextItems={pendingFiles.map((file) => ({ id: String(file.id), content: file.name, onRemove: () => handleRemovePending(file) }))}
          promptInputProps={{
            view: 'full',
            footerProps: { bottomContent: composerFooter },
            topPanel: {
              isOpen: queued !== null && queued.chatId === activeChatId,
              children: queued && (
                <div className={styles.queued} role="status">
                  <Text variant="caption-2" color="secondary" ellipsis className={styles.queuedText}>
                    Отправится, когда придёт ответ: «{queued.content}»
                    {queued.files.length > 0 ? ` + файлов: ${queued.files.length}` : ''}
                  </Text>
                  <Button view="flat-secondary" size="xs" onClick={handleUnqueue}>
                    Не отправлять
                  </Button>
                </div>
              ),
            },
          }}
        />
      </div>

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
