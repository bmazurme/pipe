import { rankByQuery } from './tfidf-rank';

describe('rankByQuery', () => {
  it('ranks a document sharing all query terms above one sharing only some', () => {
    const results = rankByQuery(
      'hull material composite',
      [
        {
          text: 'The hull uses composite material, a fibreglass and foam layup.',
          item: 'all-three',
        },
        {
          text: 'The battery pack weighs 300 grams and uses a 3S configuration.',
          item: 'unrelated',
        },
        {
          text: 'The hull shape follows a planing monohull with a single redan.',
          item: 'one-term',
        },
      ],
      5,
    );

    expect(results.map((r) => r.item)).toEqual(['all-three', 'one-term']);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('returns an empty array for an empty query', () => {
    expect(rankByQuery('', [{ text: 'anything', item: 1 }], 5)).toEqual([]);
    expect(rankByQuery('   ', [{ text: 'anything', item: 1 }], 5)).toEqual([]);
  });

  it('returns an empty array when there are no documents', () => {
    expect(rankByQuery('hull', [], 5)).toEqual([]);
  });

  it('excludes documents that share no term with the query', () => {
    const results = rankByQuery(
      'propeller pitch',
      [
        {
          text: 'Completely unrelated text about something else entirely.',
          item: 'x',
        },
      ],
      5,
    );

    expect(results).toEqual([]);
  });

  it('respects the limit', () => {
    const documents = Array.from({ length: 10 }, (_, i) => ({
      text: `decision about hull revision ${i}`,
      item: i,
    }));
    const results = rankByQuery('hull decision', documents, 3);

    expect(results).toHaveLength(3);
  });

  it('works across Russian and English text (plain bag-of-words, no cross-lingual matching)', () => {
    const results = rankByQuery(
      'масса корпуса',
      [
        {
          text: 'Масса корпуса с крышкой — 300 грамм по взвешиванию.',
          item: 'ru',
        },
        { text: 'Hull mass with the lid is 300 grams.', item: 'en' },
      ],
      5,
    );

    expect(results.map((r) => r.item)).toEqual(['ru']);
  });
});
