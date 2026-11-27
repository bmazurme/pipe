import { Bell } from '@gravity-ui/icons';
import { Card, Label, Skeleton, Text } from '@gravity-ui/uikit';

import { getErrorMessage, type NotifyBudget, useGetNotifyBudgetQuery } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import dashboardStyles from './DashboardPage.module.css';
import styles from './AlertsCard.module.css';

const POLL_MS = 60_000;

const VERDICT_THEME: Record<NotifyBudget['today']['verdict'], 'success' | 'warning' | 'danger'> = { ok: 'success', over: 'warning', noisy: 'danger' };
const VERDICT_LABEL: Record<NotifyBudget['today']['verdict'], string> = { ok: 'в бюджете', over: 'выше цели', noisy: 'шумно' };

const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

// R6: how many messages the bridge sent the owner today against the budget, what it did NOT send (repeats, groups, the night), and who is noisy —
// the numbers that say which source needs its own quieting next.
export function AlertsCard() {
  const { data, isLoading, isError, error } = useGetNotifyBudgetQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });

  return (
    <Card id="tile-alerts" view="outlined" className={dashboardStyles.card}>
      <SectionHeader title="Тревоги: сообщений в сутки" icon={Bell} />
      {isLoading ? (
        <Skeleton className={dashboardStyles.statusSkeleton} />
      ) : isError || !data || !data.today ? (
        <div className={dashboardStyles.row}>
          <Label theme="danger">Не удалось загрузить</Label>
          <Text color="secondary" variant="caption-2">
            {getErrorMessage(error, 'Ошибка запроса')}
          </Text>
        </div>
      ) : (
        <div className={styles.block}>
          <div className={styles.head}>
            <Text variant="header-1">
              {data.today.sent} из {data.target}
            </Text>
            <Label theme={VERDICT_THEME[data.today.verdict]} size="m">
              {VERDICT_LABEL[data.today.verdict]}
            </Label>
            <Text color="secondary" variant="caption-2">
              обычных сообщений сегодня (срочных: {data.today.urgent})
            </Text>
          </div>

          <Text color="secondary" variant="caption-2">
            Не отправлено отдельно: повторов {data.today.deduped}, сгруппировано {data.today.grouped}, отложено на утро {data.today.quiet}
          </Text>

          {data.today.top.length > 0 && (
            <div className={styles.top}>
              <Text variant="subheader-1">Чаще всего (попыток сегодня)</Text>
              {data.today.top.map((item) => (
                <div key={item.kind} className={styles.topRow}>
                  <Text variant="body-1">{item.kind}</Text>
                  <Text color="secondary" variant="body-1">
                    {item.attempts}
                  </Text>
                </div>
              ))}
            </div>
          )}

          {data.days.length > 1 && (
            <Text color="secondary" variant="caption-2">
              Дни: {data.days.slice(0, 7).map((day) => `${shortDay(day.day)} — ${day.sent}`).join(' · ')}
            </Text>
          )}
        </div>
      )}
    </Card>
  );
}
