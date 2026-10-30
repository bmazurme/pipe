import { CircleCheck } from '@gravity-ui/icons';
import { Alert, Button, Card, Label, Skeleton, Text } from '@gravity-ui/uikit';
import { Link } from 'react-router-dom';

import { formatRelativeTime } from '../shared/lib/formatRelativeTime';
import { getErrorMessage, type InboxItem, type InboxSeverity, useListInboxQuery } from '../store/api';
import { EmptyState } from '../widgets/EmptyState';
import { PageHeader } from '../widgets/PageHeader';
import styles from './InboxPage.module.css';

const POLL_MS = 30_000;

const SEVERITY_THEME: Record<InboxSeverity, 'danger' | 'warning' | 'normal'> = {
  high: 'danger',
  medium: 'warning',
  low: 'normal',
};

const SEVERITY_LABEL: Record<InboxSeverity, string> = {
  high: 'срочно',
  medium: 'важно',
  low: 'по возможности',
};

function ItemCard({ item }: { item: InboxItem }) {
  return (
    <Card view="outlined" className={styles.card}>
      <div className={styles.head}>
        <Label theme={SEVERITY_THEME[item.severity]} size="s">
          {SEVERITY_LABEL[item.severity]}
        </Label>
        <Text variant="subheader-2">{item.title}</Text>
        {item.since && (
          <Text variant="caption-2" color="secondary" className={styles.since}>
            {formatRelativeTime(item.since)}
          </Text>
        )}
      </div>
      {item.detail && (
        <Text variant="body-1" color="secondary" className={styles.detail}>
          {item.detail}
        </Text>
      )}
      <div className={styles.actions}>
        <Link to={item.link} className={styles.link}>
          <Button view="outlined" size="m" component="span">
            Открыть
          </Button>
        </Link>
        {item.externalUrl && (
          <Button view="flat" size="m" href={item.externalUrl} target="_blank" rel="noreferrer">
            PR на GitHub
          </Button>
        )}
      </div>
    </Card>
  );
}

// Everything that waits for the owner's decision, in one list, most urgent first. It owns no data: each row sends you to the page that does.
export function InboxPage() {
  const { data: items, isLoading, isError, error } = useListInboxQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });

  return (
    <div className={styles.page}>
      <PageHeader
        title="Решения"
        description="Что сейчас ждёт вашего решения: PR к влитию, вопросы агента, платы, лимиты и упавшие запуски. Список обновляется сам; каждая строка ведёт на страницу, где это решается."
      />

      {isLoading && <Skeleton style={{ height: 120 }} />}
      {isError && <Alert theme="danger" view="filled" message={getErrorMessage(error, 'Не удалось загрузить список')} />}
      {items && items.length === 0 && <EmptyState icon={CircleCheck} title="Ничего не ждёт решения" description="Нет PR к влитию, открытых вопросов, проблем с платами, лимитами и запусками." />}
      {items?.map((item) => (
        <ItemCard key={item.id} item={item} />
      ))}
    </div>
  );
}
