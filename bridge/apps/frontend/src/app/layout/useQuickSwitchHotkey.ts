import { useEffect } from 'react';

import { isQuickSwitchChord } from './destinationFilter';

/** Ctrl/⌘+K anywhere opens the switcher; the same chord closes it. */
export function useQuickSwitchHotkey(toggle: () => void) {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isQuickSwitchChord(event)) return;

      // Taken even from a text field: Ctrl+K means nothing else in this app, and a switcher that works everywhere but where you are typing is half a switcher.
      event.preventDefault();
      toggle();
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);
}
