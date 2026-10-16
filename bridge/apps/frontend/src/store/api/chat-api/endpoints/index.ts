import chatApi from '..';
import { deltaSince } from '../../incrementalSince';

export type ChatModelId = 'sonnet' | 'opus' | 'gpt' | 'deepseek' | 'qwen';

export interface ChatMeta {
  id: number;
  model: ChatModelId;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ChatMessageRole = 'user' | 'assistant';
export type ChatMessageStatus = 'pending' | 'running' | 'complete' | 'failed';

/** A file or image attached to a message (Claude chats only). */
export interface ChatAttachmentMeta {
  id: number;
  name: string;
  size: number;
  isImage: boolean;
  /** Null while uploaded but not yet sent. */
  messageId: number | null;
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export interface ChatMessageMeta {
  id: number;
  chatId: number;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  errorMessage: string | null;
  /** The partial reply of a running turn (what the model has written so far), or null. */
  progress?: string | null;
  attachments: ChatAttachmentMeta[];
  createdAt: string;
  updatedAt: string;
}

const chatApiEndpoints = chatApi.injectEndpoints({
  endpoints: (builder) => ({
    listChats: builder.query<ChatMeta[], void>({
      query: () => 'chat/chats',
      providesTags: ['Chat'],
    }),
    createChat: builder.mutation<ChatMeta, { model: ChatModelId }>({
      query: (body) => ({ url: 'chat/chats', method: 'POST', body }),
      invalidatesTags: ['Chat'],
    }),
    deleteChat: builder.mutation<void, number>({
      query: (id) => ({ url: `chat/chats/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Chat'],
    }),
    renameChat: builder.mutation<ChatMeta, { id: number; title: string }>({
      query: ({ id, title }) => ({ url: `chat/chats/${id}`, method: 'PATCH', body: { title } }),
      invalidatesTags: ['Chat'],
    }),
    // Polled every second while a reply is pending (ChatPage), so the whole thread would be
    // re-fetched on every tick unless this stays incremental. Once a chat's messages are cached,
    // only what's changed since the newest `updatedAt` already held is fetched and merged in —
    // a reply's `progress` ticking up, a status flip, or a brand-new message all bump it, so
    // nothing is missed. Messages are never individually deleted (only a whole chat, which drops
    // its own cache entry with it), so there's no removal case to handle on top of this.
    listMessages: builder.query<ChatMessageMeta[], number>({
      async queryFn(chatId, api, _extraOptions, baseQuery) {
        const cached = cachedMessages(api.getState, chatId);
        const since = cached?.length ? newestUpdatedAt(cached) : undefined;

        if (cached && since !== undefined) {
          const delta = await baseQuery(
            `chat/chats/${chatId}/messages?updatedAfter=${encodeURIComponent(deltaSince(since))}`,
          );
          if (delta.error) return { error: delta.error };

          return { data: mergeMessages(cached, delta.data as ChatMessageMeta[]) };
        }

        const whole = await baseQuery(`chat/chats/${chatId}/messages`);
        if (whole.error) return { error: whole.error };

        return { data: whole.data as ChatMessageMeta[] };
      },
      providesTags: (_result, _error, chatId) => [{ type: 'ChatMessages', id: chatId }],
    }),
    sendMessage: builder.mutation<
      { userMessage: ChatMessageMeta; assistantMessage: ChatMessageMeta },
      { chatId: number; content: string; attachmentIds?: number[] }
    >({
      query: ({ chatId, content, attachmentIds }) => ({
        url: `chat/chats/${chatId}/messages`,
        method: 'POST',
        body: attachmentIds && attachmentIds.length > 0 ? { content, attachmentIds } : { content },
      }),
      invalidatesTags: (_result, _error, { chatId }) => [{ type: 'ChatMessages', id: chatId }, 'Chat'],
    }),
  }),
});

function cachedMessages(getState: () => unknown, chatId: number): ChatMessageMeta[] | undefined {
  type State = Parameters<ReturnType<typeof chatApiEndpoints.endpoints.listMessages.select>>[0];

  return chatApiEndpoints.endpoints.listMessages.select(chatId)(getState() as State).data;
}

function newestUpdatedAt(messages: ChatMessageMeta[]): string | undefined {
  return messages.reduce<string | undefined>(
    (latest, message) => (latest === undefined || message.updatedAt > latest ? message.updatedAt : latest),
    undefined,
  );
}

// `createdAt` never changes, so sorting by it keeps the thread in the same order no matter how
// many times an existing message (its `progress`/`status`/`content`) is merged in-place.
function mergeMessages(cached: ChatMessageMeta[], delta: ChatMessageMeta[]): ChatMessageMeta[] {
  if (delta.length === 0) return cached;

  const byId = new Map(cached.map((message) => [message.id, message]));
  for (const message of delta) byId.set(message.id, message);

  return Array.from(byId.values()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export const {
  useListChatsQuery,
  useCreateChatMutation,
  useDeleteChatMutation,
  useRenameChatMutation,
  useListMessagesQuery,
  useSendMessageMutation,
} = chatApiEndpoints;
export { chatApiEndpoints };
