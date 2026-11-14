import type { ChannelOverview, PromoChannel, PromoMode, PromoPost, PromoPostStatus } from '../../store/api';

export const CHANNELS: PromoChannel[] = ['telegram', 'youtube', 'instagram'];

export const CHANNEL_LABEL: Record<PromoChannel, string> = {
  telegram: 'Telegram',
  youtube: 'YouTube',
  instagram: 'Instagram',
};

export const STATUS_LABEL: Record<PromoPostStatus, string> = {
  draft: 'черновик',
  approved: 'согласован',
  publishing: 'публикуется',
  published: 'опубликован',
  reminded: 'напоминание отправлено',
  failed: 'ошибка',
};

export const STATUS_THEME: Record<PromoPostStatus, 'normal' | 'info' | 'success' | 'warning' | 'danger'> = {
  draft: 'normal',
  approved: 'info',
  publishing: 'info',
  published: 'success',
  reminded: 'warning',
  failed: 'danger',
};

export const MODE_LABEL: Record<PromoMode, string> = {
  auto: 'автопубликация',
  reminder: 'напоминание',
};

// The same limits the backend checks when a post is approved (promo-limits.ts); the editor shows them while typing.
export function captionLimitFor(channel: PromoChannel, hasMedia: boolean): number {
  if (channel === 'telegram') return hasMedia ? 1024 : 4096;

  return channel === 'instagram' ? 2200 : 5000;
}

// Telegram counts a caption as the reader sees it: without the **bold** and `code` marks the editor accepts.
export function captionLength(channel: PromoChannel, text: string): number {
  if (channel !== 'telegram') return text.length;

  return text.replace(/\*\*([^*\s](?:[^*\n]*?[^*\s])?)\*\*/g, '$1').replace(/`([^`\n]+)`/g, '$1').length;
}

// The caption the channel receives: Russian, a blank line, the English paragraph.
export function joinCaption(textRu: string, textEn: string): string {
  const ru = textRu.trim();
  const en = textEn.trim();

  if (!ru) return en;

  return en ? `${ru}\n\n${en}` : ru;
}

// <input type="datetime-local"> works in local time without a zone; the server stores UTC.
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return '';

  const pad = (n: number) => String(n).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// What needs the owner's eyes: posts that failed, and approved ones whose time has passed without going out.
export function needsAttention(posts: PromoPost[], now: number = Date.now()): PromoPost[] {
  return posts.filter(
    (post) =>
      post.status === 'failed' ||
      (post.status === 'approved' && post.scheduledAt !== null && new Date(post.scheduledAt).getTime() < now),
  );
}

// The coming posts, soonest first.
export function upcoming(posts: PromoPost[], now: number = Date.now()): PromoPost[] {
  return posts
    .filter((post) => post.status === 'approved' && post.scheduledAt !== null && new Date(post.scheduledAt).getTime() >= now)
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
}

export function channelSummary(channel: ChannelOverview): string {
  const { draft, approved, published } = channel.counts;

  return `черновиков ${draft}, согласовано ${approved}, опубликовано ${published}`;
}
