import { AsideHeaderItem, MobileMenuItem } from '@gravity-ui/navigation';
import { NavigateFunction } from 'react-router-dom';

import { HOME_LINK, SERVICES, SOON_SERVICES } from '../../shared/config/services';
import { isCurrentPath, isModifiedClick, soonTitle } from './layoutUtils';

export const NAV_ITEMS = [HOME_LINK, ...SERVICES];

export function buildMenuItems(pathname: string, navigate: NavigateFunction): AsideHeaderItem[] {
  return [
    ...NAV_ITEMS.map((item) => ({
      id: item.id,
      title: item.title,
      icon: item.icon,
      current: isCurrentPath(pathname, item.path),
      // An href makes each row a real <a>: middle-click and ⌘/Ctrl+click open
      // the service in a new tab, and the target shows in the status bar on
      // hover. A plain click is still routed client-side.
      href: item.path,
      onItemClick: (
        _item: AsideHeaderItem,
        _collapsed: boolean,
        event: React.MouseEvent<HTMLElement>,
      ) => {
        if (isModifiedClick(event)) {
          return;
        }

        event.preventDefault();
        navigate(item.path);
      },
    })),
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

export function buildBurgerItems(pathname: string, navigate: NavigateFunction): MobileMenuItem[] {
  return [
    ...NAV_ITEMS.map((item) => ({
      id: item.id,
      title: item.title,
      icon: item.icon,
      current: isCurrentPath(pathname, item.path),
      onItemClick: () => navigate(item.path),
    })),
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
