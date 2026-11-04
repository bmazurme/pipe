import { chunkMarkdown } from './chunk-markdown';

describe('chunkMarkdown', () => {
  it('returns the whole text as one chunk with no heading when there is none', () => {
    const chunks = chunkMarkdown('Just a short note with no structure.');

    expect(chunks).toEqual([
      { heading: null, content: 'Just a short note with no structure.' },
    ]);
  });

  it('starts a new chunk at each heading, carrying the heading text', () => {
    const chunks = chunkMarkdown(
      [
        '# D-048',
        'Этап 0 закрыт как ненужный.',
        '',
        '## D-049',
        'Масса корпуса — 300 г.',
      ].join('\n'),
    );

    expect(chunks).toEqual([
      { heading: 'D-048', content: '# D-048\nЭтап 0 закрыт как ненужный.' },
      { heading: 'D-049', content: '## D-049\nМасса корпуса — 300 г.' },
    ]);
  });

  it('never splits a fenced code block, however long, even across a size boundary', () => {
    const codeLines = Array.from(
      { length: 50 },
      (_, i) => `line ${i} of code that is reasonably long to add up`,
    );
    const text = [
      '# Example',
      '```js',
      ...codeLines,
      '```',
      'after the fence',
    ].join('\n');

    const chunks = chunkMarkdown(text, 200);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('```js');
    expect(chunks[0].content).toContain('line 0 of code');
    expect(chunks[0].content).toContain('line 49 of code');
    expect(chunks[0].content).toContain('after the fence');
  });

  it('splits a long section only at a blank line, keeping the same heading on the continuation', () => {
    const paragraph = (n: number) =>
      `Paragraph number ${n} with enough words to take up real space in the chunk.`;
    const text = [
      '# Long section',
      ...Array.from({ length: 10 }, (_, i) => `${paragraph(i)}\n`),
    ].join('\n');

    const chunks = chunkMarkdown(text, 150);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.heading === 'Long section')).toBe(
      true,
    );
    // No paragraph is torn in half across a chunk boundary.
    for (let i = 0; i < 10; i++) {
      const whole = chunks.some((chunk) =>
        chunk.content.includes(paragraph(i)),
      );
      expect(whole).toBe(true);
    }
  });

  it('caps a single pathologically long chunk instead of growing it unbounded', () => {
    const hugeLine = 'x'.repeat(20_000);
    const chunks = chunkMarkdown(hugeLine);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content.length).toBeLessThan(20_000);
    expect(chunks[0].content).toContain('обрезано');
  });

  it('produces no chunks for an empty document instead of one blank chunk', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   \n\n  ')).toEqual([]);
  });
});
