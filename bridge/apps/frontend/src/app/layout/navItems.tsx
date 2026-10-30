import { AsideHeaderItem, MobileMenuItem } from '@gravity-ui/navigation';
import { NavigateFunction } from 'react-router-dom';

import { HOME_LINK, NAV_GROUP_ORDER, SERVICES, SOON_SERVICES, type ServiceLink, visibleServices } from '../../shared/config/services';
import { isCurrentPath, isModifiedClick, soonTitle } from './layoutUtils';
import { CountBadge } from './CountBadge';
import { StatusDot } from './StatusDot';
import styles from './AppLayout.module.css';

/** Every page the sidebar links to, flat — Home, then the sections in their order. */
export const NAV_ITEMS = [
  HOME_LINK,
  ...NAV_GROUP_ORDER.flatMap((group) => SERVICES.filter((item) => item.group === group)),
];

/** The same list split into sections (Home alone first), for the dividers between them; owner-only pages are left out for a non-owner. */
export function navSections(isOwner?: boolean): (typeof HOME_LINK | ServiceLink)[][] {
  const services = visibleServices(isOwner);

  return [[HOME_LINK], ...NAV_GROUP_ORDER.map((group) => services.filter((item) => item.group === group))].filter(
    (section) => section.length > 0,
  );
}

/** Live state shown on rows: `up` is undefined until it is known (nothing is drawn then). */
export interface NavStatus {
  workerUp?: boolean;
  /** Inbox items with `severity === 'high'`; undefined while unknown. */
  inboxUrgent?: number;
  /** All inbox items; nothing is drawn while it is unknown or zero. */
  inboxTotal?: number;
  /** From /users/me; only `false` hides the owner-only pages, so nothing disappears while it is unknown. */
  isOwner?: boolean;
}

export function buildMenuItems(
  pathname: string,
  navigate: NavigateFunction,
  status: NavStatus = {},
): AsideHeaderItem[] {
  const items: AsideHeaderItem[] = [];

  navSections(status.isOwner).forEach((section, index) => {
    if (index > 0) items.push({ id: `divider-${index}`, title: '', type: 'divider' as const });

    for (const item of section) {
      items.push({
        id: item.id,
        title: 'soon' in item && item.soon ? soonTitle(item.title) : item.title,
        icon: item.icon,
        current: isCurrentPath(pathname, item.path),
        // An href makes each row a real <a>: middle-click and ⌘/Ctrl+click open
        // the service in a new tab, and the target shows in the status bar on
        // hover. A plain click is still routed client-side.
        href: item.path,
        onItemClick: (_item: AsideHeaderItem, _collapsed: boolean, event: React.MouseEvent<HTMLElement>) => {
          if (isModifiedClick(event)) {
            return;
          }

          event.preventDefault();
          navigate(item.path);
        },
        ...(item.id === 'worker' && status.workerUp !== undefined
          ? { rightAdornment: <StatusDot up={status.workerUp} subject="Worker" /> }
          : {}),
        ...(item.id === 'inbox' && status.inboxTotal && status.inboxTotal > 0
          ? { rightAdornment: <CountBadge total={status.inboxTotal} urgent={status.inboxUrgent ?? 0} /> }
          : {}),
      });
    }
  });

  return [
    ...items,
    { id: 'soon-divider', title: '', type: 'divider' as const },
    ...SOON_SERVICES.map((item) => ({
      id: item.id,
      icon: item.icon,
      title: soonTitle(item.title),
      tooltipText: `${item.title} — скоро`,
      className: 'ntlstl-soon-item',
      // No handler, so tell assistive tech the row is inert rather than
      // leaving it announced as a live button that does nothing.
      menuItemAriaProps: { 'aria-disabled': true },
    })),
  ];
}

export function buildBurgerItems(
  pathname: string,
  navigate: NavigateFunction,
  status: NavStatus = {},
): MobileMenuItem[] {
  const items: MobileMenuItem[] = [];

  navSections(status.isOwner).forEach((section, index) => {
    if (index > 0) items.push({ id: `divider-${index}`, title: '', type: 'divider' as const });

    for (const item of section) {
      items.push({
        id: item.id,
        // The burger has no right-hand slot, so the state goes into the title itself.
        title:
          'soon' in item && item.soon ? (
            soonTitle(item.title)
          ) : item.id === 'worker' && status.workerUp !== undefined ? (
            <span className={styles.rowWithDot}>
              {item.title}
              <StatusDot up={status.workerUp} subject="Worker" />
            </span>
          ) : item.id === 'inbox' && status.inboxTotal && status.inboxTotal > 0 ? (
            <span className={styles.rowWithDot}>
              {item.title}
              <CountBadge total={status.inboxTotal} urgent={status.inboxUrgent ?? 0} />
            </span>
          ) : (
            item.title
          ),
        icon: item.icon,
        current: isCurrentPath(pathname, item.path),
        onItemClick: () => navigate(item.path),
      });
    }
  });

  return [
    ...items,
    { id: 'soon-divider', title: '', type: 'divider' as const },
    ...SOON_SERVICES.map((item) => ({
      id: item.id,
      icon: item.icon,
      title: soonTitle(item.title),
      // Tapping an unbuilt service otherwise dismisses the whole menu and
      // leaves the user on the same screen, looking like a dropped tap.
      closeMenuOnClick: false,
    })),
  ];
}
