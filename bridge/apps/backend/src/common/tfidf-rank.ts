// Ranks a small, in-memory set of texts against a query by TF-IDF cosine similarity — no embeddings model, no
// native dependency, no vector store. Deliberately not neural embeddings: the corpora this ranks (a Lab project's
// own markdown docs, one account's past analysis proposals) are a handful to a few hundred short texts, not a
// web-scale corpus, and bridge's backend runs on node:22-alpine — the ONNX runtime a real embeddings model would
// need ships prebuilt glibc binaries that fail to load on musl. This is the "vector" side of a hybrid-retrieval
// setup in spirit (term weighting + cosine distance instead of exact keyword match), sized to what it is for.
//
// Known limits: pure bag-of-words, so it cannot match a synonym or a rephrased question that shares no terms with
// the source text, and Russian/English are tokenized the same way with no stemming (a query matches an exact word
// form, not its inflections). Recomputed from scratch on every call — fine at this corpus size, would need caching
// before this corpus could grow to true "many documents" scale.

// Unicode letters/digits only, lowercased; 1-character tokens are almost always noise at this corpus size.
// The match array is typed explicitly: `match()` with a global flag returns `RegExpMatchArray | null`, which an
// inferred `?? []` has, on at least one combination of TypeScript/lib versions seen in CI, collapsed to `never[]`.
function tokenize(text: string): string[] {
  const matches: string[] = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

  return matches.filter((token) => token.length > 1);
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const frequencies = new Map<string, number>();

  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }

  return frequencies;
}

function vectorNorm(vector: Map<string, number>): number {
  let sumOfSquares = 0;

  for (const weight of vector.values()) sumOfSquares += weight * weight;

  return Math.sqrt(sumOfSquares);
}

export interface RankedMatch<T> {
  item: T;
  score: number;
}

// `documents` pairs each candidate with the text to rank it by (not necessarily the same shape as what's returned).
// Only documents that share at least one term with the query are returned (score > 0), ranked highest first, up to `limit`.
export function rankByQuery<T>(
  query: string,
  documents: { text: string; item: T }[],
  limit: number,
): RankedMatch<T>[] {
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0 || documents.length === 0) return [];

  const documentFrequencies = documents.map((doc) =>
    termFrequencies(tokenize(doc.text)),
  );

  // Document frequency of each term, for IDF: how many of the documents being ranked contain it at all.
  const docFrequency = new Map<string, number>();

  for (const frequencies of documentFrequencies) {
    for (const term of frequencies.keys()) {
      docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
    }
  }

  const totalDocs = documents.length;
  // Smoothed IDF (+1 everywhere): a term in every document still carries a small positive weight rather than
  // vanishing to log(1) = 0, which would make such terms contribute nothing to either vector's norm or dot product.
  const idf = (term: string) =>
    Math.log((totalDocs + 1) / ((docFrequency.get(term) ?? 0) + 1)) + 1;

  const toVector = (frequencies: Map<string, number>): Map<string, number> => {
    const vector = new Map<string, number>();

    for (const [term, count] of frequencies)
      vector.set(term, count * idf(term));

    return vector;
  };

  const queryVector = toVector(termFrequencies(queryTokens));
  const queryNorm = vectorNorm(queryVector);

  if (queryNorm === 0) return [];

  const scored = documents.map((doc, index) => {
    const docVector = toVector(documentFrequencies[index]);
    const docNorm = vectorNorm(docVector);

    if (docNorm === 0) return { item: doc.item, score: 0 };

    let dotProduct = 0;

    for (const [term, weight] of queryVector) {
      const docWeight = docVector.get(term);

      if (docWeight) dotProduct += weight * docWeight;
    }

    return { item: doc.item, score: dotProduct / (queryNorm * docNorm) };
  });

  return scored
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
