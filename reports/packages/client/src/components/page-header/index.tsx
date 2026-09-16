import type { ReactNode } from 'react';
import { Text } from '@gravity-ui/uikit';

import style from './page-header.module.css';

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className={style.header}>
      <div className={style.titleBox}>
        <Text as="h1" variant="header-2" className={style.title}>{title}</Text>
        {description && (
          <Text variant="body-1" color="secondary" className={style.description}>
            {description}
          </Text>
        )}
      </div>
      {actions && <div className={style.actions}>{actions}</div>}
    </header>
  )
}

export default PageHeader;
