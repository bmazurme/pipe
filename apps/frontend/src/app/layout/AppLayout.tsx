import { ReactNode, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ArrowRightFromSquare,
  ChevronRight,
  Display,
  Moon,
  Sun,
} from '@gravity-ui/icons';
import { Avatar, Button, Icon, Loader, Text } from '@gravity-ui/uikit';
import {
  AsideHeader,
  AsideHeaderItem,
  FooterItem,
  MobileHeader,
  MobileMenuItem,
  getMobileHeaderCustomEvent,
} from '@gravity-ui/navigation';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../providers/AuthProvider';
import { ThemeMode, useAppTheme } from '../providers/ThemeProvider';
import { HOME_LINK, SERVICES, SOON_SERVICES } from '../../shared/config/services';
import { useIsMobile } from '../../shared/lib/useIsMobile';
import { useLocalStorage } from '../../shared/hooks/useLocalStorage';
import { LogoMark } from '../../shared/ui/Logo';
import { createInitialIcon, getInitial } from '../../shared/ui/InitialIcon';
import { ThemeSwitcher } from '../../widgets/ThemeSwitcher';
import styles from './AppLayout.module.css';

const COMPACT_STORAGE_KEY = 'ntlstl-sidebar-compact';
/** Collapses/expands the desktop sidebar; matches the hint in its tooltip. */
const COMPACT_HOTKEY = '[';

const NAV_ITEMS = [HOME_LINK, ...SERVICES];
const MAIN_CONTENT_ID = 'main-content';

/**
 * True when the browser, not the router, should handle the click — a modified
 * click means "open this somewhere else", and hijacking it into a same-tab
 * navigation is the thing that makes in-app sidebars feel broken.
 */
function isModifiedClick(event: React.MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'system'];
const THEME_ICON: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Display,
};
const THEME_TITLE: Record<ThemeMode, string> = {
  light: 'Светлая тема',
  dark: 'Тёмная тема',
  system: 'Системная тема',
};
const THEME_SHORT: Record<ThemeMode, string> = {
  light: 'светлая',
  dark: 'тёмная',
  system: 'системная',
};

/** `/` only matches itself; the rest also own their future sub-routes. */
function isCurrentPath(pathname: string, path: string): boolean {
  return path === '/' ? pathname === '/' : pathname.startsWith(path);
}

/** Keeps the sidebar hotkey from firing while the user is typing somewhere. */
function isTypingTarget(target: EventTarget | null): boolean {
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
function soonTitle(title: string): ReactNode {
  return (
    <span className={styles.soonTitle}>
      {title}
      <span className={styles.soonBadge}>скоро</span>
    </span>
  );
}

export function AppLayout() {
  const [compact, setCompact] = useLocalStorage(COMPACT_STORAGE_KEY, false);
  const { user, logout } = useAuth();
  const { themeMode, setThemeMode } = useAppTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const headerRef = useRef<HTMLDivElement>(null);

  const nextThemeMode =
    THEME_ORDER[(THEME_ORDER.indexOf(themeMode) + 1) % THEME_ORDER.length];

  // MobileHeader owns the burger's open state and exposes no imperative API —
  // it listens for these DOM events on its own root node instead. Footer
  // actions have to close the drawer themselves; menu items already do.
  const closeBurger = useCallback(() => {
    headerRef.current?.dispatchEvent(
      getMobileHeaderCustomEvent('MOBILE_BURGER_CLOSE'),
    );
  }, []);

  const goTo = useCallback(
    (path: string) => {
      closeBurger();
      navigate(path);
    },
    [closeBurger, navigate],
  );

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

  const menuItems: AsideHeaderItem[] = [
    ...NAV_ITEMS.map((item) => ({
      id: item.id,
      title: item.title,
      icon: item.icon,
      current: isCurrentPath(location.pathname, item.path),
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

  const burgerItems: MobileMenuItem[] = [
    ...NAV_ITEMS.map((item) => ({
      id: item.id,
      title: item.title,
      icon: item.icon,
      current: isCurrentPath(location.pathname, item.path),
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

  // The logo keeps its href so it behaves like a real home link, but a plain
  // click has to be routed — left alone, the bare href reloaded the whole
  // document, throwing away the Purge draft and every cached query on the way
  // back to a page the router could have rendered instantly.
  const logo = useMemo(
    () => ({
      icon: LogoMark,
      text: 'ntlstl',
      href: '/',
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        if (isModifiedClick(event)) {
          return;
        }

        event.preventDefault();
        closeBurger();
        navigate('/');
      },
    }),
    [closeBurger, navigate],
  );

  // Rebuilt only when the initial changes: a fresh component identity on every
  // render would remount the icon (and drop it mid-transition).
  const profileIcon = useMemo(
    () => createInitialIcon(getInitial(user?.username)),
    [user?.username],
  );

  // Desktop: native aside footer rows — icon-only with tooltips when collapsed.
  const renderAsideFooter = (isCompact: boolean) => (
    <>
      <FooterItem
        compact={isCompact}
        enableTooltip
        id="theme"
        title={THEME_TITLE[themeMode]}
        tooltipText={`Тема: ${THEME_SHORT[themeMode]} → ${THEME_SHORT[nextThemeMode]}`}
        icon={THEME_ICON[themeMode]}
        onItemClick={() => setThemeMode(nextThemeMode)}
      />
      <FooterItem
        compact={isCompact}
        enableTooltip
        id="profile"
        title={user?.username ?? 'Профиль'}
        tooltipText={user?.username ?? 'Профиль'}
        icon={profileIcon}
        current={isCurrentPath(location.pathname, '/profile')}
        onItemClick={() => navigate('/profile')}
      />
      <FooterItem
        compact={isCompact}
        enableTooltip
        id="logout"
        title="Выйти"
        tooltipText="Выйти"
        icon={ArrowRightFromSquare}
        className={styles.logoutItem}
        onItemClick={() => void logout()}
      />
    </>
  );

  // Mobile: full-width burger footer, no compact mode to account for.
  const renderBurgerFooter = () => (
    <div className={styles.burgerFooter}>
      <button
        type="button"
        className={styles.userRow}
        aria-current={
          isCurrentPath(location.pathname, '/profile') ? 'page' : undefined
        }
        onClick={() => goTo('/profile')}
      >
        <Avatar text={getInitial(user?.username)} size="m" theme="brand" />
        <span className={styles.userInfo}>
          <Text variant="subheader-1" ellipsis>
            Профиль
          </Text>
          <Text color="secondary" variant="caption-2" ellipsis>
            {user?.username}
          </Text>
        </span>
        <Icon data={ChevronRight} size={16} className={styles.userRowChevron} />
      </button>

      <div className={styles.themeRow}>
        <Text color="secondary" variant="caption-2">
          Тема
        </Text>
        <ThemeSwitcher />
      </div>

      <Button
        view="flat-danger"
        size="l"
        width="max"
        onClick={() => {
          closeBurger();
          void logout();
        }}
      >
        <Icon data={ArrowRightFromSquare} size={16} />
        Выйти
      </Button>
    </div>
  );

  // Suspense sits inside the shell, not around it: while a route's chunk
  // loads, the sidebar and header stay painted and only the content area
  // shows a loader — a full-page spinner on every first visit to a page
  // would read as the whole app reloading.
  const content = (
    // A <main> landmark and a focusable skip target: without it, reaching the
    // page from the keyboard meant tabbing past every nav row and all three
    // footer rows, on every single navigation.
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className={isMobile ? styles.contentMobile : styles.content}
    >
      <Suspense
        fallback={
          <div className={styles.routeLoader}>
            <Loader size="m" />
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </main>
  );

  // Off-screen until focused, so it costs nothing visually but is the first
  // stop for a Tab press.
  const skipLink = (
    <a href={`#${MAIN_CONTENT_ID}`} className={styles.skipLink}>
      Перейти к содержимому
    </a>
  );

  if (isMobile) {
    return (
      <>
        {skipLink}
        <MobileHeader
          ref={headerRef}
          logo={logo}
          burgerOpenTitle="Открыть меню"
          burgerCloseTitle="Закрыть меню"
          renderContent={() => content}
          burgerMenu={{
            items: burgerItems,
            renderFooter: renderBurgerFooter,
          }}
        />
      </>
    );
  }

  return (
    <>
      {skipLink}
      <AsideHeader
        compact={compact}
        onChangeCompact={setCompact}
        logo={logo}
        menuItems={menuItems}
        collapseTitle={`Свернуть меню (${COMPACT_HOTKEY})`}
        expandTitle={`Развернуть меню (${COMPACT_HOTKEY})`}
        renderContent={() => content}
        renderFooter={({ compact: isCompact }) => renderAsideFooter(isCompact)}
      />
    </>
  );
}
