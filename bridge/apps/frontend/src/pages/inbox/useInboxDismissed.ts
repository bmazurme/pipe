import { useCallback, useEffect, useState } from 'react';

import { type DismissedMap, INBOX_DISMISSED_KEY } from './inboxDismissals';

const CHANGED_EVENT = 'inbox-dismissed-changed';

function read(): DismissedMap {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(INBOX_DISMISSED_KEY) ?? '{}');

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as DismissedMap) : {};
  } catch {
    return {};
  }
}

// Same localStorage key as useLocalStorage('inbox.dismissed', {}) would use, but every instance in the tab (the page and the sidebar badge) stays in sync.
export function useInboxDismissed(): [DismissedMap, (next: DismissedMap) => void] {
  const [value, setValue] = useState<DismissedMap>(read);

  useEffect(() => {
    const sync = () => setValue(read());
    window.addEventListener(CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);

    return () => {
      window.removeEventListener(CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const set = useCallback((next: DismissedMap) => {
    try {
      window.localStorage.setItem(INBOX_DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable — the in-memory state below still updates.
    }
    setValue(next);
    window.dispatchEvent(new Event(CHANGED_EVENT));
  }, []);

  return [value, set];
}
