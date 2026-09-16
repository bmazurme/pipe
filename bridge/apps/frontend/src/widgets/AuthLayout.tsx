import { ReactNode } from 'react';
import { Card, Text } from '@gravity-ui/uikit';

import { ThemeSwitcher } from './ThemeSwitcher';
import styles from './AuthLayout.module.css';

interface AuthLayoutProps {
  /** Brand mark or status glyph shown above the title. */
  icon: ReactNode;
  title: string;
  description: ReactNode;
  /** Actions — buttons stack full-width on every breakpoint. */
  children: ReactNode;
  /** Fine print under the actions. */
  footer?: ReactNode;
}

/**
 * The shell shared by every unauthenticated screen. Keeps the login and the
 * OAuth error page pixel-identical so a rejected sign-in doesn't feel like it
 * landed in a different product.
 */
export function AuthLayout({
  icon,
  title,
  description,
  children,
  footer,
}: AuthLayoutProps) {
  return (
    <div className={styles.wrapper}>
      {/* Purely decorative brand wash — kept out of the a11y tree. */}
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.themeSwitcher}>
        <ThemeSwitcher compact />
      </div>

      <Card view="outlined" className={styles.card}>
        <div className={styles.icon}>{icon}</div>

        <Text variant="header-2" as="h1" className={styles.title}>
          {title}
        </Text>

        <div className={styles.description}>
          <Text color="secondary" variant="body-2">
            {description}
          </Text>
        </div>

        <div className={styles.actions}>{children}</div>

        {footer && <div className={styles.footer}>{footer}</div>}
      </Card>
    </div>
  );
}
