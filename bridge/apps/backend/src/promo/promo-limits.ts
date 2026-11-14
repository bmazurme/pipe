// What each channel accepts. A post is kept as two texts (Russian, then English) because the channel is bilingual; the channel
// itself gets them joined into one caption.
export const PROMO_CHANNELS = ['telegram', 'youtube', 'instagram'] as const;
export type PromoChannel = (typeof PROMO_CHANNELS)[number];

export const PROMO_POST_STATUSES = [
  'draft',
  'approved',
  'published',
  'reminded',
  'failed',
] as const;
export type PromoPostStatus = (typeof PROMO_POST_STATUSES)[number];

// auto: bridge publishes by itself at scheduledAt; reminder: bridge sends the owner the files and the text to post by hand.
export const PROMO_MODES = ['auto', 'reminder'] as const;
export type PromoMode = (typeof PROMO_MODES)[number];

export interface CaptionLimit {
  limit: number;
  what: string;
}

// Telegram: 1024 for a caption under a photo or video, 4096 for a message with no media. YouTube: the description (the title is
// checked apart). Instagram: the caption.
export function captionLimit(
  channel: PromoChannel,
  hasMedia: boolean,
): CaptionLimit {
  switch (channel) {
    case 'telegram':
      return hasMedia
        ? { limit: 1024, what: 'подпись к фото или видео в Telegram' }
        : { limit: 4096, what: 'сообщение в Telegram' };
    case 'youtube':
      return { limit: 5000, what: 'описание видео на YouTube' };
    case 'instagram':
      return { limit: 2200, what: 'подпись в Instagram' };
  }
}

export const YOUTUBE_TITLE_LIMIT = 100;

// The text the channel receives: Russian first, the English paragraph after a blank line.
export function joinCaption(textRu: string, textEn: string): string {
  const ru = textRu.trim();
  const en = textEn.trim();

  if (!ru) return en;
  if (!en) return ru;

  return `${ru}\n\n${en}`;
}

// Returns why the post cannot go out as it is, or null. Counted in UTF-16 code units, like Telegram counts them.
export function captionProblem(
  channel: PromoChannel,
  title: string,
  textRu: string,
  textEn: string,
  hasMedia: boolean,
): string | null {
  const text = joinCaption(textRu, textEn);

  if (!text) return 'У поста нет текста';

  const { limit, what } = captionLimit(channel, hasMedia);

  if (text.length > limit) {
    return `Текст длиннее лимита: ${text.length} из ${limit} знаков (${what})`;
  }

  if (channel === 'youtube' && title.trim().length > YOUTUBE_TITLE_LIMIT) {
    return `Название длиннее ${YOUTUBE_TITLE_LIMIT} знаков (лимит YouTube)`;
  }

  return null;
}
