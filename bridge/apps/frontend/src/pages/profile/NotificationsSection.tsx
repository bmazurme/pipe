import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Label, Select, Skeleton, Switch, Text, TextInput } from '@gravity-ui/uikit';

import {
  getErrorMessage,
  useGetNotificationSettingsQuery,
  useUpdateNotificationSettingsMutation,
} from '../../store/api';
import { listTimeZones } from '../../shared/lib/timeZones';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../ProfilePage.module.css';
import { formatQuietHours, parseQuietHours, QuietHoursForm, validateQuietHours } from './quietHours';

export function NotificationsSection() {
  const { data, isLoading, isError } = useGetNotificationSettingsQuery();
  const [save, { isLoading: isSaving }] = useUpdateNotificationSettingsMutation();

  const [form, setForm] = useState<QuietHoursForm | null>(null);
  const [timezone, setTimezone] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  // Adopt the server values whenever they (re)load — the form is the draft.
  useEffect(() => {
    if (data) {
      setForm(parseQuietHours(data.quietHours));
      setTimezone(data.timezone);
    }
  }, [data]);

  const zones = useMemo(() => listTimeZones(timezone || data?.timezone || 'UTC'), [timezone, data?.timezone]);

  if (isLoading || (!form && !isError)) {
    return (
      <Card view="outlined" className={styles.card}>
        <Skeleton className={styles.notificationsSkeleton} />
      </Card>
    );
  }

  if (isError || !data || !form) {
    return (
      <Card view="outlined" className={styles.card}>
        <Alert theme="danger" view="filled" message="Не удалось загрузить настройки уведомлений" />
      </Card>
    );
  }

  const validation = validateQuietHours(form);
  const isDirty =
    formatQuietHours(form) !== formatQuietHours(parseQuietHours(data.quietHours)) || timezone !== data.timezone;

  const update = (patch: Partial<QuietHoursForm>) => {
    setForm({ ...form, ...patch });
    setIsSaved(false);
    setError(null);
  };

  const handleSave = async () => {
    if (validation) return;

    setError(null);

    try {
      await save({ quietHours: formatQuietHours(form), timezone }).unwrap();
      setIsSaved(true);
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось сохранить настройки'));
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <div className={styles.form}>
        <SectionHeader
          title="Уведомления в Telegram"
          actions={
            data.isQuietNow ? <Label theme="info">Сейчас тихие часы</Label> : <Label theme="normal">Сейчас обычный режим</Label>
          }
        />
        <Text color="secondary" variant="body-2">
          В тихие часы уведомления копятся и приходят утром одним сообщением. Ответы на ваши команды боту не откладываются.
        </Text>

        <Switch checked={form.enabled} onUpdate={(enabled) => update({ enabled })} content="Тихие часы" />

        <div className={styles.timeRow}>
          <label className={styles.field}>
            <Text variant="body-2" color="secondary">С</Text>
            <TextInput
              value={form.from}
              onUpdate={(from) => update({ from })}
              disabled={!form.enabled}
              controlProps={{ type: 'time', 'aria-label': 'Начало тихих часов' }}
            />
          </label>
          <label className={styles.field}>
            <Text variant="body-2" color="secondary">До</Text>
            <TextInput
              value={form.to}
              onUpdate={(to) => update({ to })}
              disabled={!form.enabled}
              controlProps={{ type: 'time', 'aria-label': 'Конец тихих часов' }}
            />
          </label>
        </div>

        <label className={styles.field}>
          <Text variant="body-2" color="secondary">Часовой пояс</Text>
          <Select
            value={[timezone]}
            onUpdate={([value]) => {
              setTimezone(value);
              setIsSaved(false);
            }}
            options={zones.map((zone) => ({ value: zone, content: zone }))}
            filterable
            width="max"
          />
        </label>

        {!data.appliesToChat && (
          <Alert
            theme="info"
            view="filled"
            message="Общий Telegram-чат использует настройки владельца — ваши значения сохранятся, но на чат не влияют."
          />
        )}
        {validation && <Alert theme="danger" view="filled" message={validation} />}
        {error && <Alert theme="danger" view="filled" message={error} />}
        {isSaved && !isDirty && <Alert theme="success" view="filled" message="Настройки сохранены" />}

        <div className={styles.actions}>
          <Button view="action" size="l" disabled={!isDirty || Boolean(validation)} loading={isSaving} onClick={() => void handleSave()}>
            Сохранить
          </Button>
        </div>
      </div>
    </Card>
  );
}
