import { useEffect, useState } from 'react';

export const SEARCH_DEBOUNCE_MS = 300;
export const MIN_SEARCH_LENGTH = 2;

// The text to search chats for: trimmed, settled for 300 ms, and empty while shorter than the backend's minimum.
export function useDebouncedSearch(text: string): string {
  const [settled, setSettled] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSettled(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return settled.length >= MIN_SEARCH_LENGTH ? settled.slice(0, 100) : '';
}
