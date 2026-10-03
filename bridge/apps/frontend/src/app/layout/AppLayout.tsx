import { Suspense, useCallback, useMemo, useRef } from 'react';
import { Loader } from '@gravity-ui/uikit';
import {
  AsideHeader,
  MobileHeader,
  getMobileHeaderCustomEvent,
} from '@gravity-ui/navigation';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../providers/AuthProvider';
import { useAppTheme } from '../providers/ThemeProvider';
import { useIsMobile } from '../../shared/lib/useIsMobile';
import { useLocalStorage } from '../../shared/hooks/useLocalStorage';
import { LogoMark } from '../../shared/ui/Logo';
import { createInitialIcon, getInitial } from '../../shared/ui/InitialIcon';
import { AsideFooter } from './AsideFooter';
import { BurgerFooter } from './BurgerFooter';
import { COMPACT_HOTKEY, COMPACT_STORAGE_KEY, isModifiedClick, MAIN_CONTENT_ID } from './layoutUtils';
import { buildBurgerItems, buildMenuItems } from './navItems';
import { THEME_ORDER } from './theme';
import { useCompactHotkey } from './useCompactHotkey';
import styles from './AppLayout.module.css';

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

  useCompactHotkey(compact, setCompact, isMobile);

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

  const menuItems = buildMenuItems(location.pathname, navigate);
  const burgerItems = buildBurgerItems(location.pathname, navigate);

  // The logo keeps its href so it behaves like a real home link, but a plain
  // click has to be routed — left alone, the bare href reloaded the whole
  // document, throwing away the Purge draft and every cached query on the way
  // back to a page the router could have rendered instantly.
  const logo = useMemo(
    () => ({
      icon: LogoMark,
      text: () => (
        <span className={styles.logoText}>
          <span>ntlstl</span>
          <span className={styles.logoVersion}>v{__APP_VERSION__}</span>
        </span>
      ),
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
            renderFooter: () => (
              <BurgerFooter
                pathname={location.pathname}
                username={user?.username}
                goTo={goTo}
                closeBurger={closeBurger}
                logout={logout}
              />
            ),
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
        renderFooter={({ compact: isCompact }) => (
          <AsideFooter
            isCompact={isCompact}
            themeMode={themeMode}
            nextThemeMode={nextThemeMode}
            setThemeMode={setThemeMode}
            username={user?.username}
            profileIcon={profileIcon}
            pathname={location.pathname}
            navigate={navigate}
            logout={logout}
          />
        )}
      />
    </>
  );
}
