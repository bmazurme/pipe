import { ReactNode } from 'react';
import { Text } from '@gravity-ui/uikit';

import styles from './SectionHeader.module.css';

interface SectionHeaderProps {
  title: string;
  /** Right-aligned metadata (counts, totals) shown next to the title. */
  meta?: ReactNode;
  /** Right-aligned controls. */
  actions?: ReactNode;
}

/** Title row shared by every card that holds a list. */
export function SectionHeader({ title, meta, actions }: SectionHeaderProps) {
  return (
    <div className={styles.root}>
      <div className={styles.titleBlock}>
        <Text variant="subheader-2" as="h2" className={styles.title}>
          {title}
        </Text>
        {meta && (
          <Text color="secondary" variant="caption-2">
            {meta}
          </Text>
        )}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
