import { useCallback, useState } from 'react';

function readValue<T>(key: string, initialValue: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? initialValue : (JSON.parse(raw) as T);
  } catch {
    // Malformed or pre-existing non-JSON value under this key — reset to
    // the default rather than throw; the next set() will overwrite it.
    return initialValue;
  }
}

/**
 * Same shape as useState, but persisted to localStorage under `key`. Reads
 * lazily on mount; every set both updates React state and writes through.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readValue(key, initialValue));

  const setStoredValue = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage full/unavailable (e.g. private browsing) — state still
        // updates in memory, it just won't persist across reloads.
      }
    },
    [key],
  );

  return [value, setStoredValue];
}
