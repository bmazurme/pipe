import { ReactNode } from 'react';
import { Icon, IconData, Text } from '@gravity-ui/uikit';

import styles from './EmptyState.module.css';

interface EmptyStateProps {
  icon: IconData;
  title: string;
  /** Optional second line explaining how to get out of the empty state. */
  description?: ReactNode;
  /** Optional call to action. */
  action?: ReactNode;
}

/**
 * The one "nothing here yet" treatment. Storage, the Purge dictionary and the
 * devices list each had their own version with different icon sizes and
 * padding; this keeps them identical.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.root}>
      <span className={styles.iconDisc}>
        <Icon data={icon} size={20} />
      </span>
      <Text variant="subheader-1">{title}</Text>
      {description && (
        <Text color="secondary" variant="body-1" className={styles.description}>
          {description}
        </Text>
      )}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
