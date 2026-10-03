import { useEffect } from 'react';

import { COMPACT_HOTKEY, isTypingTarget } from './layoutUtils';

/** Toggles the desktop sidebar's compact mode on `[`, ignoring it while mobile or while typing. */
export function useCompactHotkey(compact: boolean, setCompact: (next: boolean) => void, isMobile: boolean) {
  useEffect(() => {
    if (isMobile) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== COMPACT_HOTKEY ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      setCompact(!compact);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [compact, isMobile, setCompact]);
}
