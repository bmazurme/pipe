import promoApi from '..';

export type PromoChannel = 'telegram' | 'youtube' | 'instagram';
export type PromoMode = 'auto' | 'reminder';
export type PromoPostStatus = 'draft' | 'approved' | 'publishing' | 'published' | 'reminded' | 'failed';
export type TelegramRole = 'news' | 'discussion';

export interface PromoPost {
  id: number;
  channel: PromoChannel;
  title: string;
  textRu: string;
  textEn: string;
  assetIds: number[];
  mode: PromoMode;
  scheduledAt: string | null;
  status: PromoPostStatus;
  externalUrl: string | null;
  error: string | null;
  publishedAt: string | null;
  utmCampaign: string | null;
  /** Telegram: after the post goes to the channel, say so in the group with a link. */
  announceInGroup: boolean;
  /** The joined RU + EN text and what the channel allows for it (the editor shows «812 / 1024»). */
  captionLength: number;
  captionLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromoPostInput {
  channel: PromoChannel;
  title: string;
  textRu?: string;
  textEn?: string;
  assetIds?: number[];
  mode?: PromoMode;
  scheduledAt?: string | null;
  utmCampaign?: string | null;
  announceInGroup?: boolean;
}

export interface PromoAsset {
  id: number;
  originalName: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface ChannelOverview {
  channel: PromoChannel;
  autoPublish: boolean;
  ready: boolean;
  note: string;
  counts: Record<PromoPostStatus, number>;
  next: { id: number; title: string; scheduledAt: string } | null;
}

export interface TelegramTarget {
  role: TelegramRole;
  chatId: string;
  title: string | null;
  username: string | null;
}

/** A chat the bot has been seen in, offered for binding. */
export interface TelegramCandidate {
  chatId: string;
  type: string;
  title: string | null;
  username: string | null;
  botStatus: string | null;
  roles: TelegramRole[];
}

export interface TelegramState {
  botConfigured: boolean;
  news: TelegramTarget | null;
  discussion: TelegramTarget | null;
  candidates: TelegramCandidate[];
}

export interface PromoOverview {
  channels: ChannelOverview[];
  landing: { configured: boolean; url: string | null; activeDirName: string | null; releases: number };
  telegram: TelegramState;
}

export interface LandingRelease {
  id: number;
  label: string;
  dirName: string;
  fileCount: number;
  sizeBytes: number;
  createdAt: string;
  activatedAt: string | null;
  active: boolean;
}

export interface LandingState {
  configured: boolean;
  url: string | null;
  activeDirName: string | null;
  releases: LandingRelease[];
}

// The server's own wording (a validation error comes as a list), else the fallback.
function errorMessage(fallback: string) {
  return (response: { data?: unknown }): string => {
    const message = (response.data as { message?: string | string[] } | undefined)?.message;

    return Array.isArray(message) ? message.join(', ') : (message ?? fallback);
  };
}

// A multipart upload: the shape the backend's FileInterceptor reads.
function uploadBody(file: File, label?: string): FormData {
  const form = new FormData();

  form.append('file', file);

  if (label) form.append('label', label);

  return form;
}

const promoApiEndpoints = promoApi.injectEndpoints({
  endpoints: (builder) => ({
    getPromoOverview: builder.query<PromoOverview, void>({
      query: () => 'promo/overview',
      providesTags: ['PromoOverview'],
      transformErrorResponse: errorMessage('Не удалось загрузить обзор'),
    }),

    listPromoPosts: builder.query<PromoPost[], void>({
      query: () => 'promo/posts',
      providesTags: ['PromoPosts'],
      transformErrorResponse: errorMessage('Не удалось загрузить посты'),
    }),
    createPromoPost: builder.mutation<PromoPost, PromoPostInput>({
      query: (body) => ({ url: 'promo/posts', method: 'POST', body }),
      invalidatesTags: ['PromoPosts', 'PromoOverview'],
      transformErrorResponse: errorMessage('Не удалось создать пост'),
    }),
    updatePromoPost: builder.mutation<PromoPost, { id: number; patch: Partial<Omit<PromoPostInput, 'channel'>> }>({
      query: ({ id, patch }) => ({ url: `promo/posts/${id}`, method: 'PATCH', body: patch }),
      invalidatesTags: ['PromoPosts', 'PromoOverview'],
      transformErrorResponse: errorMessage('Не удалось сохранить пост'),
    }),
    deletePromoPost: builder.mutation<void, number>({
      query: (id) => ({ url: `promo/posts/${id}`, method: 'DELETE' }),
      invalidatesTags: ['PromoPosts', 'PromoOverview'],
      transformErrorResponse: errorMessage('Не удалось удалить пост'),
    }),
    approvePromoPost: builder.mutation<PromoPost, number>({
      query: (id) => ({ url: `promo/posts/${id}/approve`, method: 'POST' }),
      invalidatesTags: ['PromoPosts', 'PromoOverview'],
      transformErrorResponse: errorMessage('Не удалось согласовать пост'),
    }),
    unapprovePromoPost: builder.mutation<PromoPost, number>({
      query: (id) => ({ url: `promo/posts/${id}/unapprove`, method: 'POST' }),
      invalidatesTags: ['PromoPosts', 'PromoOverview'],
      transformErrorResponse: errorMessage('Не удалось вернуть пост в черновики'),
    }),
    markPromoPostPublished: builder.mutation<PromoPost, { id: number; externalUrl?: string }>({
      query: ({ id, externalUrl }) => ({ url: `promo/posts/${id}/published`, method: 'POST', body: externalUrl ? { externalUrl } : {} }),
      invalidatesTags: ['PromoPosts', 'PromoOverview'],
      transformErrorResponse: errorMessage('Не удалось отметить пост опубликованным'),
    }),

    publishPromoPostNow: builder.mutation<PromoPost, number>({
      query: (id) => ({ url: `promo/posts/${id}/publish-now`, method: 'POST' }),
      invalidatesTags: ['PromoPosts', 'PromoOverview'],
      transformErrorResponse: errorMessage('Не удалось опубликовать пост'),
    }),
    /** The same post, to the owner's own chat only. */
    testPromoPost: builder.mutation<void, number>({
      query: (id) => ({ url: `promo/posts/${id}/test`, method: 'POST' }),
      transformErrorResponse: errorMessage('Не удалось отправить тест'),
    }),

    bindTelegramTarget: builder.mutation<TelegramTarget, { role: TelegramRole; chat: string }>({
      query: ({ role, chat }) => ({ url: `promo/telegram/targets/${role}`, method: 'POST', body: { chat } }),
      invalidatesTags: ['PromoOverview'],
      transformErrorResponse: errorMessage('Не удалось привязать чат'),
    }),
    unbindTelegramTarget: builder.mutation<void, TelegramRole>({
      query: (role) => ({ url: `promo/telegram/targets/${role}`, method: 'DELETE' }),
      invalidatesTags: ['PromoOverview'],
      transformErrorResponse: errorMessage('Не удалось отвязать чат'),
    }),

    listPromoAssets: builder.query<PromoAsset[], void>({
      query: () => 'promo/assets',
      providesTags: ['PromoAssets'],
      transformErrorResponse: errorMessage('Не удалось загрузить файлы'),
    }),
    uploadPromoAsset: builder.mutation<PromoAsset, File>({
      query: (file) => ({ url: 'promo/assets', method: 'POST', body: uploadBody(file) }),
      invalidatesTags: ['PromoAssets'],
      transformErrorResponse: errorMessage('Не удалось загрузить файл'),
    }),
    deletePromoAsset: builder.mutation<void, number>({
      query: (id) => ({ url: `promo/assets/${id}`, method: 'DELETE' }),
      // A deleted file also leaves the posts that carried it.
      invalidatesTags: ['PromoAssets', 'PromoPosts'],
      transformErrorResponse: errorMessage('Не удалось удалить файл'),
    }),

    getPromoLanding: builder.query<LandingState, void>({
      query: () => 'promo/landing',
      providesTags: ['PromoLanding'],
      transformErrorResponse: errorMessage('Не удалось загрузить релизы лендинга'),
    }),
    uploadLandingRelease: builder.mutation<LandingRelease, { file: File; label?: string }>({
      query: ({ file, label }) => ({ url: 'promo/landing/releases', method: 'POST', body: uploadBody(file, label) }),
      invalidatesTags: ['PromoLanding', 'PromoOverview'],
      transformErrorResponse: errorMessage('Не удалось загрузить релиз'),
    }),
    activateLandingRelease: builder.mutation<LandingRelease, number>({
      query: (id) => ({ url: `promo/landing/releases/${id}/activate`, method: 'POST' }),
      invalidatesTags: ['PromoLanding', 'PromoOverview'],
      transformErrorResponse: errorMessage('Не удалось включить релиз'),
    }),
    deleteLandingRelease: builder.mutation<void, number>({
      query: (id) => ({ url: `promo/landing/releases/${id}`, method: 'DELETE' }),
      invalidatesTags: ['PromoLanding', 'PromoOverview'],
      transformErrorResponse: errorMessage('Не удалось удалить релиз'),
    }),
  }),
});

export const {
  useGetPromoOverviewQuery,
  useListPromoPostsQuery,
  useCreatePromoPostMutation,
  useUpdatePromoPostMutation,
  useDeletePromoPostMutation,
  useApprovePromoPostMutation,
  useUnapprovePromoPostMutation,
  useMarkPromoPostPublishedMutation,
  usePublishPromoPostNowMutation,
  useTestPromoPostMutation,
  useBindTelegramTargetMutation,
  useUnbindTelegramTargetMutation,
  useListPromoAssetsQuery,
  useUploadPromoAssetMutation,
  useDeletePromoAssetMutation,
  useGetPromoLandingQuery,
  useUploadLandingReleaseMutation,
  useActivateLandingReleaseMutation,
  useDeleteLandingReleaseMutation,
} = promoApiEndpoints;

export default promoApiEndpoints;
