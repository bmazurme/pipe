import { Label, Link, Loader, Text } from '@gravity-ui/uikit';

import { useGetImprovePrReviewQuery, type PrReview } from '../../store/api';
import { filesWord, runLine } from './prReviewFacts';
import styles from './PrReviewCard.module.css';

const RISK_THEME: Record<PrReview['risk']['level'], 'success' | 'warning' | 'danger'> = { low: 'success', medium: 'warning', high: 'danger' };

// A12: a review, not a stamp — what the change is, how risky it is, what has been checked and what has not, what the run cost.
export function PrReviewCard({ number }: { number: number }) {
  const { data, isLoading, isError } = useGetImprovePrReviewQuery(number);

  if (isLoading) return <Loader size="s" />;

  if (isError || !data) {
    return (
      <Text variant="caption-2" color="secondary">
        Карточку PR собрать не удалось — откройте его на GitHub. Merge при этом проверяется заново.
      </Text>
    );
  }

  const { diff, run } = data;

  return (
    <div className={styles.review} data-testid="pr-review">
      <div className={styles.line}>
        <Label theme={RISK_THEME[data.risk.level]}>{data.risk.text}</Label>
        <Text variant="body-1">
          {diff.files} {filesWord(diff.files)}, +{diff.additions} −{diff.deletions}
        </Text>
        <Text variant="caption-2" color="secondary">
          {diff.areas.map((area) => `${area.name} ${area.files}`).join(', ')}
        </Text>
      </div>
      {diff.largest.length > 0 && (
        <Text variant="caption-2" color="secondary">
          Крупнее всего: {diff.largest.map((file) => `${file.path} (+${file.additions} −${file.deletions})`).join(', ')}
        </Text>
      )}
      {data.attention.length > 0 && (
        <ul className={styles.list} aria-label="Обратите внимание">
          {data.attention.map((item) => (
            <li key={item}>⚠️ {item}</li>
          ))}
        </ul>
      )}
      <div className={styles.columns}>
        <div>
          <Text variant="subheader-1">Проверено</Text>
          <ul className={styles.list}>
            {data.checked.length === 0 && <li>ничего</li>}
            {data.checked.map((item) => (
              <li key={item}>✓ {item}</li>
            ))}
          </ul>
        </div>
        <div>
          <Text variant="subheader-1">Не проверено</Text>
          <ul className={styles.list}>
            {data.notChecked.map((item) => (
              <li key={item}>— {item}</li>
            ))}
          </ul>
        </div>
      </div>
      {run && (
        <Text variant="caption-2" color="secondary">
          Запуск: {runLine(run)}
          {data.improveUrl && (
            <>
              {' · '}
              <Link href={data.improveUrl} target="_blank" rel="noreferrer">
                метрики
              </Link>
            </>
          )}
        </Text>
      )}
    </div>
  );
}
