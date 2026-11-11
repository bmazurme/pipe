import { describe, expect, it } from 'vitest';

import { digestFileName, digestMarkdownFile, isIgnoredLeak, parseTags, recentWeeks, weekLabel, weekStartOf } from './digestUtils';

// 2026-11-09 is a Monday.
describe('weeks', () => {
  it('finds the Monday of a week by Moscow time', () => {
    expect(weekStartOf(new Date('2026-11-11T10:00:00Z'))).toBe('2026-11-09');
    expect(weekStartOf(new Date('2026-11-15T20:59:00Z'))).toBe('2026-11-09');
    expect(weekStartOf(new Date('2026-11-15T21:00:00Z'))).toBe('2026-11-16');
  });

  it('lists the current week and the ones before it, newest first', () => {
    expect(recentWeeks(new Date('2026-11-11T10:00:00Z'), 3)).toEqual(['2026-11-09', '2026-11-02', '2026-10-26']);
  });

  it('labels a week, also across a month', () => {
    expect(weekLabel('2026-11-09')).toBe('9–15 ноября 2026');
    expect(weekLabel('2026-11-30')).toBe('30 нояб. – 6 дек. 2026');
  });
});

describe('parseTags', () => {
  it('lowercases, drops hashes, joins words and removes duplicates', () => {
    expect(parseTags('Lab, #improve ,lab, dev work')).toEqual(['lab', 'improve', 'dev-work']);
    expect(parseTags('')).toEqual([]);
  });

  it('keeps at most 8', () => {
    expect(parseTags(Array.from({ length: 12 }, (_, i) => `t${i}`).join(','))).toHaveLength(8);
  });
});

describe('digestMarkdownFile', () => {
  it('puts the fields notes asks for in a header, then the text', () => {
    const file = digestMarkdownFile({ title: 'Неделя "9–15"', preview: 'Коротко', content: '## Итоги', tags: ['lab', 'improve'], noteType: 'Dev Work Diary' });

    expect(file).toBe('---\ntitle: "Неделя \\"9–15\\""\ntype: "Dev Work Diary"\ntags: ["lab", "improve"]\npreview: "Коротко"\n---\n\n## Итоги\n');
    expect(digestFileName('2026-11-09')).toBe('dev-diary-2026-11-09.md');
  });
});

describe('isIgnoredLeak', () => {
  it('does not count GitHub as a leak', () => {
    expect(isIgnoredLeak('github.com')).toBe(true);
    expect(isIgnoredLeak('raw.githubusercontent.com')).toBe(true);
    expect(isIgnoredLeak('git.company.ru')).toBe(false);
    expect(isIgnoredLeak('notgithub.com')).toBe(false);
  });
});
