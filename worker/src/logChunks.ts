// Bridge rejects a log chunk over 64K characters (MAX_LOG_CHUNK_LENGTH) and Express caps the JSON body at its
// default 100 kb — 64K characters of Cyrillic (2 bytes each in UTF-8) or escape-heavy output is already past that.
// 16K characters stays well under both even at 3 bytes per character plus JSON escaping.
export const MAX_LOG_CHUNK_CHARS = 16_000;

// Splits `text` into pieces of at most `maxChars` UTF-16 code units, in order, never cutting a surrogate pair
// (an emoji) in half — a lone surrogate would arrive at bridge as U+FFFD on both sides of the cut.
export function splitLogChunk(text: string, maxChars: number = MAX_LOG_CHUNK_CHARS): string[] {
  if (maxChars < 2) throw new RangeError('maxChars must be at least 2');

  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
    pieces.push(text.slice(start, end));
    start = end;
  }
  return pieces;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
