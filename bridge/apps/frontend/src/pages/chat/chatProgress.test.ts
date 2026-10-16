import { describe, expect, it } from 'vitest';

import { hideActionTail } from './chatActions';
import { formatElapsed, hasStreamedText, pendingBubbleText } from './chatProgress';

const NOW = Date.parse('2026-10-16T12:00:30.000Z');
const created = '2026-10-16T12:00:00.000Z';

describe('formatElapsed', () => {
  it('is seconds, then minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('0 с');
    expect(formatElapsed(7_900)).toBe('7 с');
    expect(formatElapsed(65_000)).toBe('1 мин 5 с');
    expect(formatElapsed(-5000)).toBe('0 с');
  });
});

describe('pendingBubbleText', () => {
  it('shows the reply so far once the model has started writing', () => {
    expect(pendingBubbleText({ status: 'running', progress: 'Первая часть ответа', createdAt: created }, NOW)).toBe(
      'Первая часть ответа',
    );
  });

  it('before that says which stage it is at and for how long', () => {
    expect(pendingBubbleText({ status: 'pending', progress: null, createdAt: created }, NOW)).toBe(
      '⏳ Ждём свободный worker… 30 с',
    );
    expect(pendingBubbleText({ status: 'running', progress: null, createdAt: created }, NOW)).toBe(
      '⏳ Модель работает… 30 с',
    );
    expect(pendingBubbleText({ status: 'running', progress: '', createdAt: created }, NOW + 40_000)).toBe(
      '⏳ Модель работает… 1 мин 10 с',
    );
  });

  it('never flashes a half-written action block', () => {
    const partial = 'Предлагаю правку.\n\n```pipe-action\n{"type":"fix-pr","pr":3';

    expect(pendingBubbleText({ status: 'running', progress: partial, createdAt: created }, NOW)).toBe(
      'Предлагаю правку.',
    );
    expect(hideActionTail('просто текст')).toBe('просто текст');
  });

  it('shows the waiting text when only the action block has been written so far', () => {
    expect(pendingBubbleText({ status: 'running', progress: '```pipe-action\n{', createdAt: created }, NOW)).toBe(
      '⏳ Модель работает… 30 с',
    );
  });
});

describe('hasStreamedText', () => {
  it('is true only for a running reply that already has visible text', () => {
    expect(hasStreamedText({ status: 'running', progress: 'abc', createdAt: created })).toBe(true);
    expect(hasStreamedText({ status: 'running', progress: null, createdAt: created })).toBe(false);
    expect(hasStreamedText({ status: 'pending', progress: 'abc', createdAt: created })).toBe(false);
    expect(hasStreamedText({ status: 'running', progress: '```pipe-action\n{', createdAt: created })).toBe(false);
  });
});
