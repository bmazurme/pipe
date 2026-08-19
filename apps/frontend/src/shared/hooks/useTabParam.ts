import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Keeps the active tab in the URL as `?tab=…`, so a reload, a bookmark or a
 * link shared between devices lands on the tab the user was actually on
 * instead of snapping back to the first one.
 *
 * The default tab is left out of the query entirely — `/time` and
 * `/time?tab=calendar` are the same screen, and only one of them should ever
 * be what a user copies out of the address bar. An unknown or hand-edited
 * value falls back to the default rather than rendering an empty panel.
 *
 * Tab switches `replace` rather than push: within one page the back button
 * should leave the page, not walk back through the tabs the user browsed.
 */
export function useTabParam(
  tabs: readonly string[],
  defaultTab: string,
): [string, (value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get('tab');
  const activeTab = requested && tabs.includes(requested) ? requested : defaultTab;

  const setActiveTab = useCallback(
    (value: string) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);

          if (value === defaultTab) {
            next.delete('tab');
          } else {
            next.set('tab', value);
          }

          return next;
        },
        { replace: true },
      );
    },
    [defaultTab, setSearchParams],
  );

  return [activeTab, setActiveTab];
}
