// Public channels named in a Lab task (a YouTube channel, an Instagram profile) and what bridge could learn about them. The worker has no
// usable web access to these sites (a login wall, a page drawn by scripts), so a run that needs "what is on our channels now" used to end in a
// question nobody could answer. Bridge reads what the platforms publish, and the run is handed the result as text.

export type ChannelKind = 'youtube' | 'instagram';

export interface ChannelRef {
  kind: ChannelKind;
  /** The address as it will be fetched/shown. */
  url: string;
  /** `@name` / `channel/UC…` for YouTube, the user name for Instagram. */
  handle: string;
}

export const MAX_CHANNELS = 3;

const YOUTUBE_RE =
  /https?:\/\/(?:www\.|m\.)?youtube\.com\/(@[\w.-]{1,60}|channel\/UC[\w-]{20,30})/gi;
const INSTAGRAM_RE =
  /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})(?=[/?#\s)>\]"']|$)/gi;
const INSTAGRAM_RESERVED = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'stories',
  'accounts',
  'tv',
  'direct',
  'about',
  'legal',
]);

// The channels a task's text points at, once each, at most MAX_CHANNELS.
export function extractChannels(text: string): ChannelRef[] {
  const found = new Map<string, ChannelRef>();

  for (const match of text.matchAll(YOUTUBE_RE)) {
    const handle = match[1];
    const key = `youtube:${handle.toLowerCase()}`;

    if (!found.has(key)) {
      found.set(key, {
        kind: 'youtube',
        handle,
        url: `https://www.youtube.com/${handle}`,
      });
    }
  }

  for (const match of text.matchAll(INSTAGRAM_RE)) {
    const handle = match[1].replace(/\.+$/, '');

    if (!handle || INSTAGRAM_RESERVED.has(handle.toLowerCase())) continue;

    const key = `instagram:${handle.toLowerCase()}`;

    if (!found.has(key)) {
      found.set(key, {
        kind: 'instagram',
        handle,
        url: `https://www.instagram.com/${handle}/`,
      });
    }
  }

  return [...found.values()].slice(0, MAX_CHANNELS);
}

const decodeEntities = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    );

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

export interface YoutubeChannelInfo {
  title: string | null;
  description: string | null;
  subscribers: string | null;
  videos: string | null;
  channelId: string | null;
}

function metaContent(html: string, key: string): string | null {
  const match = new RegExp(
    `<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`,
    'i',
  ).exec(html);

  return match ? decodeEntities(match[1]).trim() || null : null;
}

// What the public channel page carries: the counts as the page prints them ("1.2K subscribers", "45 videos"), its title and description.
export function parseYoutubeChannelPage(html: string): YoutubeChannelInfo {
  const subscribers = /(\d[\d.,]*\s?[KMB]?)\s+subscribers/i.exec(html);
  const videos = /(\d[\d,]*)\s+videos\b/i.exec(html);
  const channelId =
    /feeds\/videos\.xml\?channel_id=(UC[\w-]{20,30})/.exec(html) ??
    /"browseId":"(UC[\w-]{20,30})"/.exec(html);

  return {
    title: metaContent(html, 'og:title'),
    description:
      metaContent(html, 'og:description') ?? metaContent(html, 'description'),
    subscribers: subscribers ? subscribers[1].trim() : null,
    videos: videos ? videos[1] : null,
    channelId: channelId ? channelId[1] : null,
  };
}

export interface FeedEntry {
  title: string;
  published: string;
}

// The newest videos from the channel's public Atom feed (what YouTube itself offers for exactly this).
export function parseYoutubeFeed(xml: string, limit = 8): FeedEntry[] {
  const entries: FeedEntry[] = [];

  for (const block of xml.split('<entry>').slice(1)) {
    const title = /<title>([^<]*)<\/title>/.exec(block);
    const published = /<published>([^<]*)<\/published>/.exec(block);

    if (title) {
      entries.push({
        title: decodeEntities(title[1]).trim(),
        published: published ? published[1].slice(0, 10) : '',
      });
    }

    if (entries.length >= limit) break;
  }

  return entries;
}

export interface InstagramAccount {
  username: string;
  name: string | null;
  biography: string | null;
  followers: number | null;
  following: number | null;
  mediaCount: number | null;
}

export interface InstagramPost {
  caption: string | null;
  timestamp: string;
  type: string | null;
}

export type ChannelFact =
  | {
      ref: ChannelRef;
      ok: true;
      youtube: YoutubeChannelInfo;
      feed: FeedEntry[];
    }
  | {
      ref: ChannelRef;
      ok: true;
      instagram: InstagramAccount;
      posts: InstagramPost[];
    }
  | { ref: ChannelRef; ok: false; reason: string };

function describeYoutube(
  fact: Extract<ChannelFact, { youtube: YoutubeChannelInfo }>,
): string {
  const { youtube, feed, ref } = fact;
  const parts = [
    `YouTube «${youtube.title ?? ref.handle}» (${ref.url})`,
    `подписчиков: ${youtube.subscribers ?? 'не показано'}`,
    `видео: ${youtube.videos ?? 'не показано'}`,
  ];
  const lines = [`- ${parts[0]}: ${parts[1]}, ${parts[2]}.`];

  if (youtube.description) {
    lines.push(`  Описание канала: ${clip(youtube.description, 400)}`);
  }

  if (feed.length > 0) {
    lines.push(
      `  Последние видео: ${feed.map((entry) => `«${clip(entry.title, 90)}»${entry.published ? ` (${entry.published})` : ''}`).join('; ')}.`,
    );
  }

  return lines.join('\n');
}

function describeInstagram(
  fact: Extract<ChannelFact, { instagram: InstagramAccount }>,
): string {
  const { instagram, posts, ref } = fact;
  const num = (value: number | null) =>
    value === null ? 'не показано' : String(value);
  const lines = [
    `- Instagram @${instagram.username}${instagram.name ? ` «${instagram.name}»` : ''} (${ref.url}): подписчиков: ${num(instagram.followers)}, публикаций: ${num(instagram.mediaCount)}.`,
  ];

  if (instagram.biography) {
    lines.push(`  Описание профиля: ${clip(instagram.biography, 300)}`);
  }

  const captions = posts
    .filter((post) => post.caption)
    .slice(0, 8)
    .map(
      (post) =>
        `«${clip((post.caption as string).replace(/\s+/g, ' '), 120)}» (${post.timestamp.slice(0, 10)})`,
    );

  if (captions.length > 0) {
    lines.push(`  Последние публикации: ${captions.join('; ')}.`);
  }

  return lines.join('\n');
}

// The block appended to the task. It says plainly what could not be read, so the run records that and goes on instead of asking.
export function formatChannelFacts(facts: ChannelFact[], at: Date): string {
  if (facts.length === 0) return '';

  const lines = facts.map((fact) => {
    if (!fact.ok) {
      return `- ${fact.ref.kind === 'youtube' ? 'YouTube' : 'Instagram'} ${fact.ref.url}: данные получить не удалось — ${fact.reason}.`;
    }

    return 'youtube' in fact ? describeYoutube(fact) : describeInstagram(fact);
  });

  return [
    `Данные о публичных каналах, названных в задаче (bridge прочитал их ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC; у воркера доступа к этим сайтам нет, поэтому не открывайте их и не задавайте по ним вопросов — работайте с этими данными):`,
    ...lines,
    'Если какого-то значения здесь нет, так и напишите в результате («не удалось получить») и продолжайте с остальным.',
  ].join('\n');
}
