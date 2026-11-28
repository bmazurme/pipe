import { Key } from '@gravity-ui/icons';
import { Button, Card, Label, Skeleton, Text } from '@gravity-ui/uikit';

import { getErrorMessage, type RotationItem, type RotationStatus, useGetRotationQuery, useMarkRotatedMutation } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import dashboardStyles from './DashboardPage.module.css';
import styles from './RotationCard.module.css';
import { copyText, dueText } from './rotationFacts';

const POLL_MS = 5 * 60_000;

const THEME: Record<RotationStatus, 'success' | 'warning' | 'danger'> = { ok: 'success', warn: 'warning', bad: 'danger' };
const WORD: Record<RotationStatus, string> = { ok: 'в порядке', warn: 'есть замечания', bad: 'проблема' };

function Row({ item, copies, marking, onMark }: { item: RotationItem; copies: string[]; marking: boolean; onMark: () => void }) {
  const due = dueText(item);

  return (
    <div className={styles.item}>
      <div className={styles.head}>
        <Label theme={THEME[item.status]} size="s">
          {WORD[item.status]}
        </Label>
        <Text variant="subheader-2">{item.label}</Text>
        {due && (
          <Text color="secondary" variant="caption-2">
            {due}
          </Text>
        )}
        {item.intervalDays > 0 && (
          <Button size="xs" view="outlined" loading={marking} onClick={onMark} title="Отметить, что ключ только что сменили">
            Сменил(а)
          </Button>
        )}
      </div>
      {item.reasons.length > 0 && (
        <div className={styles.reasons}>
          {item.reasons.map((reason) => (
            <Text key={reason} variant="caption-2" color={item.status === 'bad' ? 'danger' : 'warning'}>
              {reason}
            </Text>
          ))}
        </div>
      )}
      {copies.length > 0 && (
        <div className={styles.copies}>
          {copies.map((text) => (
            <Label key={text} size="s" theme={text.includes('не расшифровала') ? 'danger' : 'unknown'}>
              {text}
            </Label>
          ))}
        </div>
      )}
    </div>
  );
}

// S11: what has to be changed when, and whether the backup key's copies really open a backup (infra/backup/key-check.sh). The calendar only
// reminds; the steps are in docs/key-rotation.md.
export function RotationCard() {
  const { data, isLoading, isError, error } = useGetRotationQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });
  const [mark, { isLoading: marking, originalArgs }] = useMarkRotatedMutation();

  return (
    <Card id="tile-rotation" view="outlined" className={dashboardStyles.card}>
      <SectionHeader title="Ключи и ротация" icon={Key} />
      {isLoading ? (
        <Skeleton className={dashboardStyles.statusSkeleton} />
      ) : isError || !data || !Array.isArray(data.items) ? (
        <div className={dashboardStyles.row}>
          <Label theme="danger">Не удалось загрузить</Label>
          <Text color="secondary" variant="caption-2">
            {getErrorMessage(error, 'Ошибка запроса')}
          </Text>
        </div>
      ) : (
        <div className={styles.list}>
          {data.items.map((item) => (
            <Row
              key={item.key}
              item={item}
              copies={item.key === 'age-key' ? data.keyCopies.copies.map((copy) => copyText(copy)) : []}
              marking={marking && originalArgs?.key === item.key}
              onMark={() => void mark({ key: item.key })}
            />
          ))}
          <Text color="secondary" variant="caption-2">
            Порядок смены каждого ключа — docs/key-rotation.md. Календарь ничего не меняет сам.
          </Text>
        </div>
      )}
    </Card>
  );
}
