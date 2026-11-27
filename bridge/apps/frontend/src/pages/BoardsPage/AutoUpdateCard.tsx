import { useEffect, useState } from 'react';
import { Alert, Button, Card, Label, Switch, Text, TextInput } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { getErrorMessage, useGetAutoUpdateQuery, useSaveAutoUpdateMutation } from '../../store/api';
import styles from './AutoUpdateCard.module.css';

const RESULT_LABEL: Record<string, string> = { applied: 'обновлён', failed: 'не удалось', pending: 'ждёт плату', cancelled: 'отменено', expired: 'устарело' };

// R2: bridge may update the workers on the boards by itself — only in this window, one board at a time, never under a running job, and never again a
// release that failed on a board. Off until switched on here. The button on each board stays as it was.
export function AutoUpdateCard() {
  const { data, isLoading, isError, error } = useGetAutoUpdateQuery(undefined, { pollingInterval: 60_000, skipPollingIfUnfocused: true });
  const [save, { isLoading: saving, error: saveError }] = useSaveAutoUpdateMutation();
  const [enabled, setEnabled] = useState(false);
  const [window, setWindow] = useState('03:00-05:00');
  const [timezone, setTimezone] = useState('Europe/Moscow');

  useEffect(() => {
    if (!data) return;

    setEnabled(data.enabled);
    setWindow(data.window);
    setTimezone(data.timezone);
  }, [data]);

  if (isLoading) return null;

  if (isError || !data) {
    return <Alert theme="danger" view="filled" message={getErrorMessage(error, 'Не удалось загрузить настройку автообновления')} />;
  }

  const dirty = enabled !== data.enabled || window !== data.window || timezone !== data.timezone;
  const failure = saveError ? (typeof saveError === 'string' ? saveError : getErrorMessage(saveError, 'Не удалось сохранить')) : null;

  return (
    <Card view="outlined" className={styles.card}>
      <div className={styles.head}>
        <Text variant="subheader-2">Автообновление worker</Text>
        <Label theme={data.enabled ? 'success' : 'normal'}>{data.enabled ? 'включено' : 'выключено'}</Label>
        {data.enabled && <Label theme={data.inWindowNow ? 'info' : 'unknown'}>{data.inWindowNow ? 'сейчас окно' : 'вне окна'}</Label>}
      </div>
      <Text variant="caption-2" color="secondary">
        Когда на плате образ worker отстаёт от свежего релиза, bridge сам разрешает ей обновиться — только в окне ниже, по одной плате за раз, не при работающей задаче, и не повторяет релиз, который на этой плате уже не удался. Кнопка «Обновить worker» остаётся как была.
      </Text>

      <div className={styles.form}>
        <Switch checked={enabled} onUpdate={setEnabled} content="Обновлять worker самому" />
        <TextInput label="Окно" value={window} onUpdate={setWindow} placeholder="03:00-05:00" size="m" className={styles.field} />
        <TextInput label="Часовой пояс" value={timezone} onUpdate={setTimezone} placeholder="Europe/Moscow" size="m" className={styles.field} />
        <Button view="action" loading={saving} disabled={!dirty} onClick={() => void save({ enabled, window, timezone })}>
          Сохранить
        </Button>
      </div>

      {failure && <Alert theme="danger" message={failure} />}

      {data.last && (
        <Text variant="caption-2" color="secondary">
          Последнее автообновление: {data.last.host} — {RESULT_LABEL[data.last.status] ?? data.last.status}
          {data.last.at ? `, ${formatRelativeTime(data.last.at)}` : ''}
          {data.last.status === 'failed' && data.last.result ? ` (${data.last.result.slice(0, 160)})` : ''}
        </Text>
      )}
    </Card>
  );
}
