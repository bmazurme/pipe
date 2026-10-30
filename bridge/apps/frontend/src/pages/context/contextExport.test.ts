import { describe, expect, it } from 'vitest';

import { contextFilename } from './contextExport';

describe('contextFilename', () => {
  it('appends .md to a plain name', () => {
    expect(contextFilename('Project notes', 1)).toBe('Project notes.md');
  });

  it('strips path separators, quotes and control characters', () => {
    expect(contextFilename('a/b\\c:d*e?"f<g>h|i\n', 1)).toBe('a b c d e f g h i.md');
  });

  it('collapses whitespace', () => {
    expect(contextFilename('  a    b  ', 1)).toBe('a b.md');
  });

  it('caps the length', () => {
    expect(contextFilename('x'.repeat(300), 1)).toBe(`${'x'.repeat(80)}.md`);
  });

  it('falls back to the id when nothing usable is left', () => {
    expect(contextFilename('', 7)).toBe('context-7.md');
    expect(contextFilename('/:"?', 7)).toBe('context-7.md');
    expect(contextFilename('..', 7)).toBe('context-7.md');
  });

  it('keeps non-latin names', () => {
    expect(contextFilename('Правила проекта', 1)).toBe('Правила проекта.md');
  });
});
