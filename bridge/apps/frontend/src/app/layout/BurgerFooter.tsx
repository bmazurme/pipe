import { ArrowRightFromSquare, ChevronRight } from '@gravity-ui/icons';
import { Avatar, Button, Icon, Text } from '@gravity-ui/uikit';

import { getInitial } from '../../shared/ui/InitialIcon';
import { ThemeSwitcher } from '../../widgets/ThemeSwitcher';
import styles from './AppLayout.module.css';
import { isCurrentPath } from './layoutUtils';

interface BurgerFooterProps {
  pathname: string;
  username: string | undefined;
  goTo: (path: string) => void;
  closeBurger: () => void;
  logout: () => void | Promise<void>;
}

// Mobile: full-width burger footer, no compact mode to account for.
export function BurgerFooter({ pathname, username, goTo, closeBurger, logout }: BurgerFooterProps) {
  return (
    <div className={styles.burgerFooter}>
      <button
        type="button"
        className={styles.userRow}
        aria-current={isCurrentPath(pathname, '/profile') ? 'page' : undefined}
        onClick={() => goTo('/profile')}
      >
        <Avatar text={getInitial(username)} size="m" theme="brand" />
        <span className={styles.userInfo}>
          <Text variant="subheader-1" ellipsis>
            Профиль
          </Text>
          <Text color="secondary" variant="caption-2" ellipsis>
            {username}
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
}
