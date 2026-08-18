import {
  ArrowRightFromSquare,
  Bucket,
  Clock,
  Display,
  House,
  MagicWand,
  Moon,
  Person,
  Sun,
  TrashBin,
} from '@gravity-ui/icons';
import { Avatar, Button, Icon, Text } from '@gravity-ui/uikit';
import { AsideHeader, FooterItem, MobileHeader } from '@gravity-ui/navigation';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../providers/AuthProvider';
import { ThemeMode, useAppTheme } from '../providers/ThemeProvider';
import { useIsMobile } from '../../shared/lib/useIsMobile';
import { useLocalStorage } from '../../shared/hooks/useLocalStorage';
import { LogoMark } from '../../shared/ui/Logo';
import { ThemeSwitcher } from '../../widgets/ThemeSwitcher';
import styles from './AppLayout.module.css';

const COMPACT_STORAGE_KEY = 'ntlstl-sidebar-compact';
const LOGO = { icon: LogoMark, text: 'ntlstl', href: '/' };

// Placeholder links for services that will be added in later steps.
const FEATURE_LINKS = [
  { id: 'time', title: 'Time', icon: Clock },
  { id: 'rag', title: 'RAG', icon: MagicWand },
];

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

export function AppLayout() {
  const [compact, setCompact] = useLocalStorage(COMPACT_STORAGE_KEY, false);
  const { user, logout } = useAuth();
  const { themeMode, setThemeMode } = useAppTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const nextThemeMode =
    THEME_ORDER[(THEME_ORDER.indexOf(themeMode) + 1) % THEME_ORDER.length];

  const menuItems = [
    {
      id: 'home',
      title: 'Главная',
      icon: House,
      current: location.pathname === '/',
      onItemClick: () => navigate('/'),
    },
    {
      id: 'storage',
      title: 'Storage',
      icon: Bucket,
      current: location.pathname === '/storage',
      onItemClick: () => navigate('/storage'),
    },
    {
      id: 'purge',
      title: 'Purge',
      icon: TrashBin,
      current: location.pathname === '/purge',
      onItemClick: () => navigate('/purge'),
    },
    { id: 'soon-divider', title: '', type: 'divider' as const },
    // The burger menu ignores item.className, so the "скоро" hint lives in the
    // title node itself — that renders in both the aside and the burger.
    ...FEATURE_LINKS.map((item) => ({
      ...item,
      title: (
        <span className={styles.soonTitle}>
          {item.title}
          <span className={styles.soonBadge}>скоро</span>
        </span>
      ),
      tooltipText: `${item.title} — скоро`,
      className: 'ntlstl-soon-item',
    })),
  ];

  // Desktop: native aside footer rows — icon-only with tooltips when collapsed.
  const renderAsideFooter = (isCompact: boolean) => (
    <>
      <FooterItem
        compact={isCompact}
        enableTooltip
        id="theme"
        title={THEME_TITLE[themeMode]}
        tooltipText={`${THEME_TITLE[themeMode]} — переключить`}
        icon={THEME_ICON[themeMode]}
        onItemClick={() => setThemeMode(nextThemeMode)}
      />
      <FooterItem
        compact={isCompact}
        enableTooltip
        id="profile"
        title={user?.username ?? 'Профиль'}
        tooltipText={user?.username ?? 'Профиль'}
        icon={Person}
        current={location.pathname === '/profile'}
        onItemClick={() => navigate('/profile')}
      />
      <FooterItem
        compact={isCompact}
        enableTooltip
        id="logout"
        title="Выйти"
        tooltipText="Выйти"
        icon={ArrowRightFromSquare}
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
        onClick={() => navigate('/profile')}
      >
        <Avatar text={user?.username ?? '?'} size="m" />
        <span className={styles.userInfo}>
          <Text variant="subheader-1" ellipsis>
            Профиль
          </Text>
          <Text color="secondary" ellipsis>
            {user?.username}
          </Text>
        </span>
      </button>
      <ThemeSwitcher />
      <Button view="flat" width="max" onClick={() => void logout()}>
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
        logo={LOGO}
        renderContent={() => content}
        burgerMenu={{
          items: menuItems,
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
      renderContent={() => content}
      renderFooter={({ compact: isCompact }) => renderAsideFooter(isCompact)}
    />
  );
}
