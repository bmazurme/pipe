import { ReactNode } from 'react';
import { Alert } from '@gravity-ui/uikit';

import { useIsNonOwner } from '../store/hooks';
import { PageHeader } from './PageHeader';
import styles from './OwnerOnly.module.css';

/** The neutral notice shown in place of a section whose routes only the deployment owner may call. */
export function OwnerOnlyNotice() {
  return <Alert theme="normal" view="filled" message="Доступно только владельцу развёртывания" />;
}

/**
 * Wraps an owner-only route. Another account reaching it directly sees the
 * notice instead of a page whose every request would come back 403.
 */
export function OwnerOnlyPage({ title, children }: { title: string; children: ReactNode }) {
  if (useIsNonOwner()) {
    return (
      <div className={styles.page}>
        <PageHeader title={title} />
        <OwnerOnlyNotice />
      </div>
    );
  }

  return <>{children}</>;
}
