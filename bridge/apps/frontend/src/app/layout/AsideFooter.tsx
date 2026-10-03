import { ArrowRightFromSquare } from '@gravity-ui/icons';
import { FooterItem } from '@gravity-ui/navigation';

import { ThemeMode } from '../providers/ThemeProvider';
import { createInitialIcon } from '../../shared/ui/InitialIcon';
import styles from './AppLayout.module.css';
import { isCurrentPath } from './layoutUtils';
import { THEME_ICON, THEME_SHORT, THEME_TITLE } from './theme';

interface AsideFooterProps {
  isCompact: boolean;
  themeMode: ThemeMode;
  nextThemeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  username: string | undefined;
  profileIcon: ReturnType<typeof createInitialIcon>;
  pathname: string;
  navigate: (path: string) => void;
  logout: () => void | Promise<void>;
}

// Desktop: native aside footer rows — icon-only with tooltips when collapsed.
export function AsideFooter({
  isCompact,
  themeMode,
  nextThemeMode,
  setThemeMode,
  username,
  profileIcon,
  pathname,
  navigate,
  logout,
}: AsideFooterProps) {
  return (
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
        title={username ?? 'Профиль'}
        tooltipText={username ?? 'Профиль'}
        icon={profileIcon}
        current={isCurrentPath(pathname, '/profile')}
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
}
