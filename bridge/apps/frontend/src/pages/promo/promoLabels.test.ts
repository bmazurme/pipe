import { describe, expect, it } from 'vitest';

import type { PromoPost } from '../../store/api';
import { captionLength, captionLimitFor, fromLocalInput, joinCaption, needsAttention, toLocalInput, upcoming } from './promoLabels';

const post = (over: Partial<PromoPost>): PromoPost => ({
  id: 1,
  channel: 'telegram',
  title: 'T',
  textRu: 'x',
  textEn: '',
  assetIds: [],
  mode: 'auto',
  scheduledAt: null,
  status: 'draft',
  externalUrl: null,
  error: null,
  publishedAt: null,
  utmCampaign: null,
  announceInGroup: false,
  captionLength: 1,
  captionLimit: 4096,
  createdAt: '2026-11-14T00:00:00Z',
  updatedAt: '2026-11-14T00:00:00Z',
  ...over,
});

describe('captionLimitFor', () => {
  it('matches the channel limits', () => {
    expect(captionLimitFor('telegram', true)).toBe(1024);
    expect(captionLimitFor('telegram', false)).toBe(4096);
    expect(captionLimitFor('instagram', true)).toBe(2200);
    expect(captionLimitFor('youtube', false)).toBe(5000);
  });
});

describe('captionLength', () => {
  it('counts a Telegram caption as the reader sees it, other channels as written', () => {
    expect(captionLength('telegram', '**Привет** `мир`')).toBe(10);
    expect(captionLength('instagram', '**Привет** `мир`')).toBe(16);
    // a stray pair of stars is text, not a mark
    expect(captionLength('telegram', '2 ** 3')).toBe(6);
  });
});

describe('joinCaption', () => {
  it('puts the English paragraph after a blank line', () => {
    expect(joinCaption(' Привет ', ' Hello ')).toBe('Привет\n\nHello');
    expect(joinCaption('', 'Hello')).toBe('Hello');
    expect(joinCaption('Привет', '')).toBe('Привет');
  });
});

describe('local time input', () => {
  it('round-trips through the browser local time', () => {
    const iso = '2026-11-20T10:30:00.000Z';

    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });

  it('is empty for no date or a bad one', () => {
    expect(toLocalInput(null)).toBe('');
    expect(toLocalInput('nonsense')).toBe('');
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('nonsense')).toBeNull();
  });
});

describe('needsAttention / upcoming', () => {
  const now = new Date('2026-11-15T12:00:00Z').getTime();
  const posts = [
    post({ id: 1, status: 'failed' }),
    post({ id: 2, status: 'approved', scheduledAt: '2026-11-14T10:00:00Z' }),
    post({ id: 3, status: 'approved', scheduledAt: '2026-11-17T10:00:00Z' }),
    post({ id: 4, status: 'approved', scheduledAt: '2026-11-16T10:00:00Z' }),
    post({ id: 5, status: 'approved', scheduledAt: null }),
    post({ id: 6, status: 'draft', scheduledAt: '2026-11-14T10:00:00Z' }),
  ];

  it('flags failed posts and approved ones that are overdue', () => {
    expect(needsAttention(posts, now).map((p) => p.id)).toEqual([1, 2]);
  });

  it('lists the approved future ones, soonest first', () => {
    expect(upcoming(posts, now).map((p) => p.id)).toEqual([4, 3]);
  });
});
