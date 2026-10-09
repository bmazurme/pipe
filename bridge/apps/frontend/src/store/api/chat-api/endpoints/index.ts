import chatApi from '..';

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
    listMessages: builder.query<ChatMessageMeta[], number>({
      query: (chatId) => `chat/chats/${chatId}/messages`,
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

export const {
  useListChatsQuery,
  useCreateChatMutation,
  useDeleteChatMutation,
  useRenameChatMutation,
  useListMessagesQuery,
  useSendMessageMutation,
} = chatApiEndpoints;
export { chatApiEndpoints };
