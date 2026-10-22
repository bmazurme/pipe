import { Button, Card, Label, Text } from '@gravity-ui/uikit';

import { useGetFailureSummaryQuery } from '../../store/api';
import styles from '../WorkerPage.module.css';

interface FailureBreakdownProps {
  onOpenJob: (jobId: number) => void;
}

const DAYS = 7;

// Answers "what is failing, and how often?": the success rate of the last week and the most frequent
// failures. Renders nothing while loading or when nothing failed.
export function FailureBreakdown({ onOpenJob }: FailureBreakdownProps) {
  const { data } = useGetFailureSummaryQuery(DAYS);

  if (!data?.failed || !data.groups) return null;

  const rate = Math.round(((data.total - data.failed) / data.total) * 100);

  return (
    <Card view="outlined" className={styles.statusStrip}>
      <div className={styles.statusRow}>
        <Text color="secondary" variant="body-2">
          Ошибки за {DAYS} дн.
        </Text>
        <Label theme={rate >= 90 ? 'success' : rate >= 70 ? 'warning' : 'danger'}>Успешно: {rate}%</Label>
        <Text color="secondary" variant="caption-2">
          {data.failed} из {data.total}
        </Text>
      </div>
      {data.groups.map((group) => (
        <div key={group.message} className={styles.statusRow}>
          <Text variant="body-2">{group.count}×</Text>
          <Text variant="body-2">{group.message}</Text>
          {group.infra && <Label theme="info">инфраструктура</Label>}
          <Button view="flat" size="s" onClick={() => onOpenJob(group.lastJobId)}>
            Открыть последнюю
          </Button>
        </div>
      ))}
    </Card>
  );
}
