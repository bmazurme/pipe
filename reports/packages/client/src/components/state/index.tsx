import { Button, Icon, Skeleton, Text } from '@gravity-ui/uikit';
import { ArrowRotateLeft, CircleXmark } from '@gravity-ui/icons';
import type { ReactNode } from 'react';

import style from './state.module.css';

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
  action?: ReactNode;
}

export function ErrorState({ title = 'Не удалось загрузить данные', message, onRetry, action }: ErrorStateProps) {
  return (
    <div className={style.state} role="alert">
      <Icon data={CircleXmark} size={32} className={style.errorIcon} />
      <Text variant="subheader-2">{title}</Text>
      <Text variant="body-1" color="secondary" className={style.message}>{message}</Text>
      <div className={style.actions}>
        {onRetry && (
          <Button view="action" size="m" onClick={onRetry}>
            <Icon data={ArrowRotateLeft} size={16} />
            Повторить
          </Button>
        )}
        {action}
      </div>
    </div>
  )
}

type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className={style.state}>
      <span className={style.emptyIcon}>{icon}</span>
      <Text variant="subheader-1">{title}</Text>
      {description && <Text variant="body-1" color="secondary" className={style.message}>{description}</Text>}
      {action && <div className={style.actions}>{action}</div>}
    </div>
  )
}

/** Layout-matching placeholder so the page does not jump once the data arrives. */
export function PageSkeleton() {
  return (
    <div className={style.skeleton} aria-busy="true" aria-live="polite">
      <span className={style.srOnly}>Загрузка данных…</span>
      <Skeleton className={style.skeletonHeader} />
      <div className={style.skeletonRow}>
        <Skeleton className={style.skeletonTile} />
        <Skeleton className={style.skeletonTile} />
        <Skeleton className={style.skeletonTile} />
      </div>
      <Skeleton className={style.skeletonBlock} />
    </div>
  )
}
