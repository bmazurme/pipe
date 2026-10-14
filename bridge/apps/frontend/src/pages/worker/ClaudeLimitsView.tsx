import { Progress, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import type { ClaudeLimits } from '../../store/api';
import styles from '../WorkerPage.module.css';
import { limitRows } from './claudeLimits';

interface Props {
  limits: ClaudeLimits | null;
  /** Said when there is nothing yet; leave out to render nothing. */
  emptyText?: string;
  now?: number;
}

// The plan limits a Claude run last reported: one bar per window, and when it was learned. The CLI only says
// this while it runs, so the numbers are a snapshot — the caption says so.
export function ClaudeLimitsView({ limits, emptyText, now = Date.now() }: Props) {
  if (!limits) {
    return emptyText ? (
      <Text color="secondary" variant="caption-2">
        {emptyText}
      </Text>
    ) : null;
  }

  const rows = limitRows(limits, now);

  if (rows.length === 0) return null;

  return (
    <div className={styles.limits} role="group" aria-label="Лимиты Claude">
      {rows.map((row) => (
        <div key={row.key} className={styles.limitRow}>
          <Text variant="caption-2" className={styles.limitLabel}>
            {row.label}
          </Text>
          <Progress
            value={row.percent}
            theme={row.theme}
            size="xs"
            className={styles.limitBar}
          />
          <Text variant="caption-2" color={row.theme === 'success' ? 'secondary' : row.theme === 'warning' ? 'warning' : 'danger'}>
            {row.percent}%{row.reset ? ` · ${row.reset}` : ''}
          </Text>
        </div>
      ))}
      <Text variant="caption-2" color="secondary">
        {limits.status === 'rejected' ? 'Лимит исчерпан · ' : ''}
        {limits.isUsingOverage ? 'идёт доп. использование · ' : ''}
        данные {formatRelativeTime(limits.reportedAt, now)}
      </Text>
    </div>
  );
}
