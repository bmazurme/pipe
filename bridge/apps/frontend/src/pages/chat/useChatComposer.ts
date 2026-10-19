import { useCallback, useEffect, useState } from 'react';
import type { TSubmitData } from '@gravity-ui/aikit';

import { ChatAttachmentMeta, ChatModelId, MAX_ATTACHMENTS_PER_MESSAGE, useCreateChatMutation, useSendMessageMutation } from '../../store/api';
import { attachmentProblem, deleteChatAttachment, uploadChatAttachment } from './chatAttachments';

// A message written while the previous reply is still on its way: it goes out on its own once that reply is in.
interface QueuedMessage {
  chatId: number;
  content: string;
  files: ChatAttachmentMeta[];
}

interface UseChatComposerParams {
  activeChatId: number | null;
  setActiveChatId: (id: number | null) => void;
  newChatModel: ChatModelId;
  newChatContextId: number | undefined;
  hasPendingReply: boolean;
  lastReplyStatus: string | undefined;
  messagesLoaded: boolean;
  accessToken: string | null;
}

export function useChatComposer({
  activeChatId,
  setActiveChatId,
  newChatModel,
  newChatContextId,
  hasPendingReply,
  lastReplyStatus,
  messagesLoaded,
  accessToken,
}: UseChatComposerParams) {
  const [createChat] = useCreateChatMutation();
  const [sendMessage] = useSendMessageMutation();

  // Files uploaded for the message being written; they travel with it when it is sent.
  const [pendingFiles, setPendingFiles] = useState<ChatAttachmentMeta[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  // The text of a message that could not be sent — AIKit has already cleared the composer, so it is kept here to resend.
  const [failedDraft, setFailedDraft] = useState<string | null>(null);
  const [queued, setQueued] = useState<QueuedMessage | null>(null);

  // The chat must exist before a file can be uploaded to it, so attaching in the empty state
  // starts the chat (with the model currently picked) just as sending would.
  const ensureChat = useCallback(async (): Promise<number> => {
    if (activeChatId !== null) return activeChatId;

    const chat = await createChat({ model: newChatModel, contextId: newChatContextId }).unwrap();
    setActiveChatId(chat.id);

    return chat.id;
  }, [activeChatId, createChat, newChatModel, newChatContextId, setActiveChatId]);

  const attachFiles = async (files: File[]) => {
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

  const removePending = (attachment: ChatAttachmentMeta) => {
    setPendingFiles((current) => current.filter((file) => file.id !== attachment.id));
    void deleteChatAttachment(attachment.id, accessToken);
  };

  const deliver = useCallback(
    async (content: string, files: ChatAttachmentMeta[], chatId?: number) => {
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
    },
    [ensureChat, sendMessage],
  );

  const send = async (data: TSubmitData) => {
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
  useEffect(() => {
    if (!queued || queued.chatId !== activeChatId || hasPendingReply || !messagesLoaded) return;

    setQueued(null);

    if (lastReplyStatus === 'failed') {
      setPendingFiles((current) => [...current, ...queued.files]);
      setFailedDraft(queued.content);
      setChatError('Предыдущий ответ не пришёл, поэтому сообщение не отправлено');

      return;
    }

    void deliver(queued.content, queued.files, queued.chatId);
  }, [queued, activeChatId, hasPendingReply, messagesLoaded, lastReplyStatus, deliver]);

  const unqueue = () => {
    if (!queued) return;
    setPendingFiles((current) => [...current, ...queued.files]);
    setFailedDraft(queued.content);
    setQueued(null);
  };

  const copyDraft = () => {
    if (failedDraft) void navigator.clipboard?.writeText(failedDraft).catch(() => undefined);
  };

  // Sends the failed draft again together with the files still attached.
  const resend = () => {
    if (failedDraft !== null) void deliver(failedDraft, pendingFiles);
  };

  const dismissError = () => {
    setChatError(null);
    setFailedDraft(null);
  };

  // Leaving the chat being written in: what was prepared for it is dropped (a queued message stays with its chat).
  const reset = () => {
    setPendingFiles([]);
    setChatError(null);
    setFailedDraft(null);
  };

  // The chat is gone: its queued message goes with it.
  const dropChat = (chatId: number) => {
    if (activeChatId === chatId) setPendingFiles([]);
    setQueued((current) => (current?.chatId === chatId ? null : current));
  };

  return {
    pendingFiles,
    isUploading,
    chatError,
    failedDraft,
    queued,
    attachFiles,
    removePending,
    send,
    unqueue,
    copyDraft,
    reset,
    resend,
    dismissError,
    dropChat,
    setChatError,
  };
}
