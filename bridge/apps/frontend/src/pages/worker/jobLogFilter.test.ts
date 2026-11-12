import { describe, expect, it } from 'vitest';

import { filterLogLines } from './jobLogFilter';

describe('filterLogLines', () => {
  it('keeps the matching lines, ignoring case', () => {
    expect(filterLogLines('ok\nError: boom\nfine\nan error here\n', 'ERROR')).toEqual({
      text: 'Error: boom\nan error here',
      matched: 2,
      total: 4,
    });
  });

  it('returns the whole log for an empty or blank query', () => {
    expect(filterLogLines('one\ntwo\n', '')).toEqual({ text: 'one\ntwo\n', matched: 2, total: 2 });
    expect(filterLogLines('one\ntwo\n', '   ')).toEqual({ text: 'one\ntwo\n', matched: 2, total: 2 });
  });

  it('does not count a trailing newline as an extra line', () => {
    expect(filterLogLines('a\nb\n', 'x')).toEqual({ text: '', matched: 0, total: 2 });
    expect(filterLogLines('a\nb', 'b')).toEqual({ text: 'b', matched: 1, total: 2 });
  });

  it('handles an empty log', () => {
    expect(filterLogLines('', 'x')).toEqual({ text: '', matched: 0, total: 0 });
    expect(filterLogLines('', '')).toEqual({ text: '', matched: 0, total: 0 });
  });
});
