import type { ReactElement } from 'react';
import { Text, Button, Icon, Tooltip } from '@gravity-ui/uikit';
import {
  House, Calendar as CalendarIcon, ListCheck, Gear, Moon, Sun, ChevronsLeft, ChevronsRight, Xmark,
} from '@gravity-ui/icons';
import { Link, useLocation } from 'react-router-dom';

import { useMediaQuery } from '../../hooks/use-media-query';
import { useTheme } from '../../hooks/use-theme';
import { useSidebarCollapse } from '../../hooks/use-sidebar-collapse';

import style from './sidebar.module.css';

const links = [
  { to: '/', label: 'Отчёт', icon: House },
  { to: '/calendar', label: 'Календарь', icon: CalendarIcon },
  { to: '/subscription', label: 'Подписка', icon: ListCheck },
  { to: '/settings', label: 'Настройки', icon: Gear },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const { collapsed, toggleCollapsed } = useSidebarCollapse();
  const isMobile = useMediaQuery('(max-width: 768px)');
  // The mobile drawer always shows labels, so tooltips only help on the collapsed desktop rail
  const showTooltips = collapsed && !isMobile;
  const themeLabel = isDark ? 'Светлая тема' : 'Тёмная тема';
  const collapseLabel = collapsed ? 'Развернуть меню' : 'Свернуть меню';

  const withTooltip = (content: string, node: ReactElement) => (
    showTooltips ? <Tooltip content={content} placement="right">{node}</Tooltip> : node
  );

  return (
    <div className={`${style.sidebar} ${collapsed ? style.collapsed : ''}`}>
      <div className={style.workspace}>
        <div className={style.mark} aria-hidden="true">n</div>
        <div className={`${style.meta} ${collapsed ? style.hidden : ''}`}>
          <Text variant="subheader-2">ntlstl.time</Text>
          <Text variant="caption-2" color="secondary">Учёт рабочего времени</Text>
        </div>
        {onNavigate && (
          <Button
            view="flat"
            size="m"
            onClick={onNavigate}
            className={style.closeButton}
            aria-label="Закрыть меню"
          >
            <Icon data={Xmark} size={16} />
          </Button>
        )}
      </div>
      <nav className={style.nav} aria-label="Основная навигация">
        {links.map(({ to, label, icon }) => {
          const current = pathname === to;

          return withTooltip(label, (
            <Button
              key={to}
              view={current ? 'normal' : 'flat'}
              size="l"
              width="max"
              component={Link}
              to={to}
              className={`${style.navButton} ${current ? style.navButtonActive : ''}`}
              aria-current={current ? 'page' : undefined}
              aria-label={collapsed ? label : undefined}
              onClick={onNavigate}
            >
              <Icon data={icon} size={16} />
              <span className={`${style.label} ${collapsed ? style.hidden : ''}`}>{label}</span>
            </Button>
          ));
        })}
      </nav>
      <div className={style.footer}>
        {withTooltip(themeLabel, (
          <Button
            view="flat"
            size="l"
            width="max"
            onClick={toggleTheme}
            className={style.navButton}
            aria-label={themeLabel}
          >
            <Icon data={isDark ? Sun : Moon} size={16} />
            <span className={`${style.label} ${collapsed ? style.hidden : ''}`}>{themeLabel}</span>
          </Button>
        ))}
        <div className={style.collapseBar}>
          {withTooltip(collapseLabel, (
            <Button
              view="flat"
              size="l"
              width="max"
              onClick={toggleCollapsed}
              className={style.navButton}
              aria-label={collapseLabel}
              aria-expanded={!collapsed}
            >
              <Icon data={collapsed ? ChevronsRight : ChevronsLeft} size={16} />
              <span className={`${style.label} ${collapsed ? style.hidden : ''}`}>Свернуть</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Sidebar;
