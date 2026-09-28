// Mirrors bridge's purgeUtils.ts suggestUniqueValue — plain random-string
// generation, no @pipe/protocol dependency, so it's safe to duplicate here
// rather than share (reports' client has no dependency on that package at
// all; the actual dictionary substitution runs server-side instead).
const SUGGESTION_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomToken(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += SUGGESTION_ALPHABET[Math.floor(Math.random() * SUGGESTION_ALPHABET.length)];
  }
  return result;
}

// Same length as the key, retried a few times against the values already in
// use so the suggestion is unique out of the box.
export function suggestUniqueValue(length: number, taken: Set<string>): string {
  if (length <= 0) return '';

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = randomToken(length);
    if (!taken.has(candidate)) return candidate;
  }

  return randomToken(length);
}
