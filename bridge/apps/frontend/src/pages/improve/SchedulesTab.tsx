import { useState } from 'react';
import { Pencil, Play, Plus, TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Card, Dialog, Icon, Label, Select, Skeleton, Switch, Text, TextInput } from '@gravity-ui/uikit';
import { Clock } from '@gravity-ui/icons';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { listTimeZones } from '../../shared/lib/timeZones';
import {
  getErrorMessage,
  ImproveSchedule,
  useDeleteImproveScheduleMutation,
  useGetImproveSettingsQuery,
  useListImproveSchedulesQuery,
  useRunImproveScheduleNowMutation,
  useSaveImproveScheduleMutation,
  useSaveImproveSettingsMutation,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import { MODEL_OPTIONS } from '../worker/constants';
import styles from '../ImprovePage.module.css';
import { describeSchedule, formatTime, ScheduleForm, validateScheduleForm } from './improveLabels';

const DEFAULT_FORM: ScheduleForm = { name: 'Ночной запуск', enabled: true, time: '02:00', timezone: 'Europe/Moscow', count: '5', model: 'sonnet' };
type Form = ScheduleForm;

function toForm(schedule: ImproveSchedule): Form {
  return {
    name: schedule.name,
    enabled: schedule.enabled,
    time: formatTime(schedule.hour, schedule.minute),
    timezone: schedule.timezone,
    count: String(schedule.count),
    model: schedule.model,
  };
}

function AutoStartCard() {
  const { data } = useGetImproveSettingsQuery();
  const [save, { isLoading }] = useSaveImproveSettingsMutation();

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Автозапуск посылок из Subscription" />
      <Text color="secondary" variant="body-2">
        Посылка, отправленная из reports (Subscription → Push), сразу уходит на worker с выбранной моделью — без ручного «Запустить» на странице Worker.
        Включайте что-то одно: этот переключатель или такой же в самом reports. Посылки, загруженные до включения, не запускаются.
      </Text>
      <div className={styles.toolbar}>
        <Select
          size="m"
          label="Модель:"
          disabled={isLoading || !data}
          value={[data?.autoStartModel ?? 'off']}
          onUpdate={([value]) => void save({ autoStartModel: value === 'off' ? null : value })}
          options={[{ value: 'off', content: 'Выключен' }, ...MODEL_OPTIONS]}
        />
      </div>
    </Card>
  );
}

export function SchedulesTab() {
  const { data: schedules, isLoading } = useListImproveSchedulesQuery();
  const [saveSchedule, { isLoading: isSaving }] = useSaveImproveScheduleMutation();
  const [deleteSchedule] = useDeleteImproveScheduleMutation();
  const [runNow, { isLoading: isRunning }] = useRunImproveScheduleNowMutation();

  const [editing, setEditing] = useState<{ id?: number; form: Form } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSave = async () => {
    if (!editing) return;

    const input = validateScheduleForm(editing.form);

    if (typeof input === 'string') {
      setError(input);
      return;
    }

    try {
      await saveSchedule({ id: editing.id, input }).unwrap();
      setEditing(null);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось сохранить расписание'));
    }
  };

  const handleRunNow = async (schedule: ImproveSchedule) => {
    setNotice(null);
    setError(null);

    try {
      const result = await runNow(schedule.id).unwrap();
      setNotice(`Запущено: ${result.started.length ? result.started.map((n) => `#${n}`).join(', ') : 'ничего'}${result.skipped.length ? `; пропущено ${result.skipped.length}` : ''}`);
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось запустить расписание'));
    }
  };

  const update = (patch: Partial<Form>) => editing && setEditing({ ...editing, form: { ...editing.form, ...patch } });

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <Button view="action" size="m" onClick={() => { setError(null); setEditing({ form: DEFAULT_FORM }); }}>
          <Icon data={Plus} size={16} />
          Новое расписание
        </Button>
      </div>

      {notice && <Alert theme="success" view="filled" message={notice} />}
      {error && !editing && <Alert theme="danger" view="filled" message={error} />}
      {isLoading && <Skeleton style={{ height: 80 }} />}

      {schedules && schedules.length === 0 && (
        <EmptyState icon={Clock} title="Расписаний нет" description="Например: каждую ночь в 02:00 запускать 5 самых старых задач с меткой loop." />
      )}

      {schedules?.map((schedule) => (
        <div key={schedule.id} className={styles.row}>
          <div className={styles.rowMain}>
            <Text variant="body-2">{schedule.name}</Text>
            <Text variant="caption-2" color="secondary">{describeSchedule(schedule)}</Text>
            {schedule.lastRunAt && (
              <Text variant="caption-2" color="secondary">
                последний запуск {formatRelativeTime(schedule.lastRunAt)}{schedule.lastResult && ` · ${schedule.lastResult}`}
              </Text>
            )}
          </div>
          <div className={styles.rowActions}>
            {!schedule.enabled && <Label theme="normal">выключено</Label>}
            <Button view="flat-secondary" size="s" loading={isRunning} aria-label={`Запустить сейчас: ${schedule.name}`} title="Запустить сейчас" onClick={() => void handleRunNow(schedule)}>
              <Icon data={Play} size={16} />
            </Button>
            <Button view="flat-secondary" size="s" aria-label={`Изменить: ${schedule.name}`} onClick={() => { setError(null); setEditing({ id: schedule.id, form: toForm(schedule) }); }}>
              <Icon data={Pencil} size={16} />
            </Button>
            <Button view="flat-danger" size="s" aria-label={`Удалить: ${schedule.name}`} onClick={() => void deleteSchedule(schedule.id)}>
              <Icon data={TrashBin} size={16} />
            </Button>
          </div>
        </div>
      ))}

      <AutoStartCard />

      <Dialog open={editing !== null} onClose={() => setEditing(null)} maxWidth="s" aria-labelledby="schedule-title">
        <Dialog.Header caption={editing?.id ? 'Изменить расписание' : 'Новое расписание'} id="schedule-title" />
        <Dialog.Body>
          {editing && (
            <div className={styles.form}>
              <TextInput label="Название" value={editing.form.name} onUpdate={(name) => update({ name })} />
              <div className={styles.timeRow}>
                <TextInput label="Время" value={editing.form.time} onUpdate={(time) => update({ time })} controlProps={{ type: 'time', 'aria-label': 'Время запуска' }} />
                <TextInput label="Задач" value={editing.form.count} onUpdate={(count) => update({ count })} controlProps={{ type: 'number', min: 1, max: 20, 'aria-label': 'Количество задач' }} />
              </div>
              <Select
                label="Часовой пояс"
                value={[editing.form.timezone]}
                onUpdate={([timezone]) => update({ timezone })}
                options={listTimeZones(editing.form.timezone).map((zone) => ({ value: zone, content: zone }))}
                filterable
                width="max"
              />
              <Select label="Модель" value={[editing.form.model]} onUpdate={([model]) => update({ model })} options={MODEL_OPTIONS} width="max" />
              <Switch checked={editing.form.enabled} onUpdate={(enabled) => update({ enabled })} content="Включено" />
              {error && <Alert theme="danger" view="filled" message={error} />}
            </div>
          )}
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Сохранить"
          propsButtonApply={{ loading: isSaving }}
          onClickButtonCancel={() => setEditing(null)}
          onClickButtonApply={() => void handleSave()}
        />
      </Dialog>
    </div>
  );
}
