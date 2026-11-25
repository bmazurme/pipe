import type { InboxItem } from '../../store/api';

export const INBOX_DISMISSED_KEY = 'inbox.dismissed';

// item id -> fingerprint of the item as it was when the owner hid it.
export type DismissedMap = Record<string, string>;

// These two must stay visible: hiding them would make the «nothing waits» empty state misleading again.
const UNDISMISSABLE_KINDS: ReadonlySet<string> = new Set(['loop_paused', 'source_unavailable']);

export function isDismissable(item: Pick<InboxItem, 'kind'>): boolean {
  return !UNDISMISSABLE_KINDS.has(item.kind);
}

// Any change in the underlying fact changes the title or detail, which changes the fingerprint and brings the item back.
export function fingerprint(item: Pick<InboxItem, 'id' | 'title' | 'detail'>): string {
  return `${item.id}\u0000${item.title}\u0000${item.detail ?? ''}`;
}

export function splitDismissed(items: readonly InboxItem[], dismissed: DismissedMap): { visible: InboxItem[]; hidden: InboxItem[] } {
  const visible: InboxItem[] = [];
  const hidden: InboxItem[] = [];

  for (const item of items) {
    if (isDismissable(item) && dismissed[item.id] === fingerprint(item)) {
      hidden.push(item);
    } else {
      visible.push(item);
    }
  }

  return { visible, hidden };
}

// Drops entries whose id is no longer listed, so the stored map cannot grow without bound. Returns the same object when nothing changed.
export function pruneDismissed(items: readonly InboxItem[], dismissed: DismissedMap): DismissedMap {
  const ids = new Set(items.map((item) => item.id));
  const keys = Object.keys(dismissed);

  if (keys.every((id) => ids.has(id))) {
    return dismissed;
  }

  return Object.fromEntries(keys.filter((id) => ids.has(id)).map((id) => [id, dismissed[id]]));
}
