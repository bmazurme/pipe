import styles from './AppLayout.module.css';

export const COMPACT_STORAGE_KEY = 'ntlstl-sidebar-compact';
/** Collapses/expands the desktop sidebar; matches the hint in its tooltip. */
export const COMPACT_HOTKEY = '[';
export const MAIN_CONTENT_ID = 'main-content';

/**
 * True when the browser, not the router, should handle the click — a modified
 * click means "open this somewhere else", and hijacking it into a same-tab
 * navigation is the thing that makes in-app sidebars feel broken.
 */
export function isModifiedClick(event: React.MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/** `/` only matches itself; the rest also own their future sub-routes. */
export function isCurrentPath(pathname: string, path: string): boolean {
  return path === '/' ? pathname === '/' : pathname.startsWith(path);
}

/** Keeps the sidebar hotkey from firing while the user is typing somewhere. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

// The burger menu ignores item.className, so the "скоро" hint lives in the
// title node itself — that renders in both the aside and the burger.
export function soonTitle(title: string) {
  return (
    <span className={styles.soonTitle}>
      {title}
      <span className={styles.soonBadge}>скоро</span>
    </span>
  );
}
