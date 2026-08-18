import { ReactNode } from 'react';
import { Text } from '@gravity-ui/uikit';

import styles from './PageHeader.module.css';

interface PageHeaderProps {
  title: string;
  /** One line explaining what the page is for. */
  description?: ReactNode;
  /** Page-level actions, right-aligned on desktop and wrapped below on mobile. */
  actions?: ReactNode;
}

/**
 * The single header treatment for every route. Each page used to hand-roll its
 * own title block, so heading sizes and the title/description gap drifted
 * apart between them.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.titleBlock}>
        <Text variant="header-1" as="h1" className={styles.title}>
          {title}
        </Text>
        {description && <Text color="secondary">{description}</Text>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
