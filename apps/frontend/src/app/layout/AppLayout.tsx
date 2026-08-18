import { ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ArrowRightFromSquare,
  Bucket,
  ChevronRight,
  Clock,
  Display,
  House,
  MagicWand,
  Moon,
  Sun,
  TrashBin,
} from '@gravity-ui/icons';
import { Avatar, Button, Icon, Text } from '@gravity-ui/uikit';
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
import { useIsMobile } from '../../shared/lib/useIsMobile';
import { useLocalStorage } from '../../shared/hooks/useLocalStorage';
import { LogoMark } from '../../shared/ui/Logo';
import { createInitialIcon, getInitial } from '../../shared/ui/InitialIcon';
import { ThemeSwitcher } from '../../widgets/ThemeSwitcher';
import styles from './AppLayout.module.css';

const COMPACT_STORAGE_KEY = 'ntlstl-sidebar-compact';
/** Collapses/expands the desktop sidebar; matches the hint in its tooltip. */
const COMPACT_HOTKEY = '[';
const LOGO = { icon: LogoMark, text: 'ntlstl', href: '/' };

const NAV_ITEMS = [
  { id: 'home', title: 'Главная', icon: House, path: '/' },
  { id: 'storage', title: 'Storage', icon: Bucket, path: '/storage' },
  { id: 'purge', title: 'Purge', icon: TrashBin, path: '/purge' },
  { id: 'time', title: 'Time', icon: Clock, path: '/time' },
];

// Placeholder links for services that will be added in later steps.
const SOON_ITEMS = [{ id: 'rag', title: 'RAG', icon: MagicWand }];

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
      onItemClick: () => navigate(item.path),
    })),
    { id: 'soon-divider', title: '', type: 'divider' as const },
    ...SOON_ITEMS.map((item) => ({
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
    ...SOON_ITEMS.map((item) => ({
      id: item.id,
      icon: item.icon,
      title: soonTitle(item.title),
      // Tapping an unbuilt service otherwise dismisses the whole menu and
      // leaves the user on the same screen, looking like a dropped tap.
      closeMenuOnClick: false,
    })),
  ];

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

  const content = (
    <div className={isMobile ? styles.contentMobile : styles.content}>
      <Outlet />
    </div>
  );

  if (isMobile) {
    return (
      <MobileHeader
        ref={headerRef}
        logo={LOGO}
        burgerOpenTitle="Открыть меню"
        burgerCloseTitle="Закрыть меню"
        renderContent={() => content}
        burgerMenu={{
          items: burgerItems,
          renderFooter: renderBurgerFooter,
        }}
      />
    );
  }

  return (
    <AsideHeader
      compact={compact}
      onChangeCompact={setCompact}
      logo={LOGO}
      menuItems={menuItems}
      collapseTitle={`Свернуть меню (${COMPACT_HOTKEY})`}
      expandTitle={`Развернуть меню (${COMPACT_HOTKEY})`}
      renderContent={() => content}
      renderFooter={({ compact: isCompact }) => renderAsideFooter(isCompact)}
    />
  );
}
