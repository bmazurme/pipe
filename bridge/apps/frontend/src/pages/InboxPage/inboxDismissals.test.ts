import { describe, expect, it } from 'vitest';

import type { InboxItem } from '../../store/api';
import { fingerprint, pruneDismissed, splitDismissed } from './inboxDismissals';

const item = (over: Partial<InboxItem> & Pick<InboxItem, 'id'>): InboxItem =>
  ({ kind: 'pr_waiting', severity: 'low', title: 'PR #7 ждёт', detail: 'CI не запускался', link: '/improve', ...over }) as InboxItem;

describe('inboxDismissals', () => {
  it('hides an item while its fingerprint matches', () => {
    const a = item({ id: 'pr:7' });
    const { visible, hidden } = splitDismissed([a, item({ id: 'questions', kind: 'questions' })], { 'pr:7': fingerprint(a) });

    expect(hidden.map((i) => i.id)).toEqual(['pr:7']);
    expect(visible.map((i) => i.id)).toEqual(['questions']);
  });

  it('brings a hidden pr:N item back when it goes from pr_waiting to pr_failing', () => {
    const dismissed = { 'pr:7': fingerprint(item({ id: 'pr:7' })) };
    const failing = item({ id: 'pr:7', kind: 'pr_failing', severity: 'high', title: 'PR #7: CI красный', detail: 'tests failed' });

    const { visible, hidden } = splitDismissed([failing], dismissed);

    expect(visible).toEqual([failing]);
    expect(hidden).toEqual([]);
  });

  it('never hides loop_paused or source_unavailable', () => {
    const a = item({ id: 'loop', kind: 'loop_paused' });
    const b = item({ id: 'sources-unavailable', kind: 'source_unavailable' });

    expect(splitDismissed([a, b], { loop: fingerprint(a), 'sources-unavailable': fingerprint(b) }).hidden).toEqual([]);
  });

  it('prunes ids that are no longer listed', () => {
    const a = item({ id: 'pr:7' });
    const dismissed = { 'pr:7': fingerprint(a), 'pr:8': 'x' };

    expect(pruneDismissed([a], dismissed)).toEqual({ 'pr:7': fingerprint(a) });
    expect(pruneDismissed([a], { 'pr:7': fingerprint(a) })).toEqual({ 'pr:7': fingerprint(a) });
  });
});
