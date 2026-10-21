import { useMemo, useState } from 'react';
import { Clock, Pencil, Play, Plus, TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Icon, Label, Select, Skeleton, Switch, Text, TextArea, TextInput } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { listTimeZones } from '../../shared/lib/timeZones';
import {
  getErrorMessage,
  type LabExecutor,
  LabSchedule,
  useDeleteLabScheduleMutation,
  useListContextsQuery,
  useListLabProjectsQuery,
  useListLabSchedulesQuery,
  useRunLabScheduleNowMutation,
  useSaveLabScheduleMutation,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { MODEL_OPTIONS } from '../worker/constants';
import { EXECUTOR_HINT, EXECUTOR_OPTIONS, executorLabel } from './executors';
import styles from '../ImprovePage.module.css';
import { formatTime, modelLabel, parseTime } from '../improve/improveLabels';
import { sortSchedulesByRunTime } from '../improve/scheduleOrder';
import { ALL_WEEKDAYS, formatWeekdays, WEEKDAYS } from './weekdays';

interface Form {
  projectId: string;
  name: string;
  enabled: boolean;
  time: string;
  timezone: string;
  weekdays: number[];
  model: string;
  executor: LabExecutor;
  task: string;
  contextId: string;
}

const DEFAULT_FORM: Form = { projectId: '', name: 'Ночной запуск', enabled: true, time: '02:00', timezone: 'Europe/Moscow', weekdays: ALL_WEEKDAYS, model: 'sonnet', executor: 'any', task: '', contextId: '' };

export function SchedulesTab() {
  const { data: schedules, isLoading, isError } = useListLabSchedulesQuery();
  const { data: projects } = useListLabProjectsQuery();
  const { data: contexts } = useListContextsQuery();
  const [save, { isLoading: isSaving }] = useSaveLabScheduleMutation();
  const [remove] = useDeleteLabScheduleMutation();
  const [runNow] = useRunLabScheduleNowMutation();
  const [editing, setEditing] = useState<{ id?: number; form: Form } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<LabSchedule | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sorted = useMemo(() => sortSchedulesByRunTime(schedules ?? []), [schedules]);
  const projectName = (id: number) => projects?.find((project) => project.id === id)?.name ?? `#${id}`;

  const open = (schedule?: LabSchedule) => {
    setError(null);
    setEditing(
      schedule
        ? {
            id: schedule.id,
            form: {
              projectId: String(schedule.projectId),
              name: schedule.name,
              enabled: schedule.enabled,
              time: formatTime(schedule.hour, schedule.minute),
              timezone: schedule.timezone,
              weekdays: schedule.weekdays?.length ? schedule.weekdays : ALL_WEEKDAYS,
              model: schedule.model,
              executor: schedule.executor ?? 'any',
              task: schedule.task,
              contextId: schedule.contextId === null ? '' : String(schedule.contextId),
            },
          }
        : { form: { ...DEFAULT_FORM, projectId: projects?.[0] ? String(projects[0].id) : '' } },
    );
  };

  const handleSave = async () => {
    if (!editing) return;

    const { form } = editing;
    const time = parseTime(form.time);

    if (!form.projectId) return setError('Выберите проект');
    if (!form.name.trim()) return setError('Укажите название');
    if (!time) return setError('Укажите время в формате ЧЧ:ММ');
    if (form.task.trim().length < 3) return setError('Опишите задачу текстом');
    if (form.weekdays.length === 0) return setError('Выберите хотя бы один день недели');

    try {
      await save({
        id: editing.id,
        input: {
          projectId: Number(form.projectId),
          name: form.name.trim(),
          enabled: form.enabled,
          hour: time.hour,
          minute: time.minute,
          timezone: form.timezone,
          weekdays: form.weekdays.length === ALL_WEEKDAYS.length ? null : [...form.weekdays].sort((a, b) => a - b),
          model: form.model,
          executor: form.executor,
          task: form.task.trim(),
          contextId: form.contextId ? Number(form.contextId) : null,
        },
      }).unwrap();
      setEditing(null);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось сохранить расписание'));
    }
  };

  const handleRunNow = async (schedule: LabSchedule) => {
    setNotice(null);
    setError(null);
    setRunningId(schedule.id);

    try {
      const result = await runNow(schedule.id).unwrap();

      if (result.error) setError(`Не запущено: ${result.error}`);
      else setNotice(`Запущено: запуск #${result.runId}`);
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось запустить расписание'));
    } finally {
      setRunningId(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;

    const { id } = confirmDelete;

    setConfirmDelete(null);

    try {
      await remove(id).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось удалить расписание'));
    }
  };

  const update = (patch: Partial<Form>) => editing && setEditing({ ...editing, form: { ...editing.form, ...patch } });

  const toggleWeekday = (day: number) =>
    editing && update({ weekdays: editing.form.weekdays.includes(day) ? editing.form.weekdays.filter((d) => d !== day) : [...editing.form.weekdays, day] });

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <Button view="action" size="m" disabled={!projects?.length} onClick={() => open()}>
          <Icon data={Plus} size={16} />
          Новое расписание
        </Button>
        {projects && projects.length === 0 && (
          <Text variant="caption-2" color="secondary">
            Сначала подключите проект на вкладке «Проекты».
          </Text>
        )}
      </div>

      {notice && <Alert theme="success" view="filled" message={notice} />}
      {error && !editing && <Alert theme="danger" view="filled" message={error} />}
      {isLoading && <Skeleton style={{ height: 80 }} />}
      {isError && <Alert theme="danger" view="filled" message="Не удалось загрузить расписания" />}

      {schedules && schedules.length === 0 && (
        <EmptyState icon={Clock} title="Расписаний нет" description="Например: каждую ночь в 02:00 обновлять зависимости в проекте и открывать pull request." />
      )}

      {sorted.map((schedule) => (
        <div key={schedule.id} className={styles.row}>
          <div className={styles.rowMain}>
            <Text variant="body-2">{schedule.name}</Text>
            <Text variant="caption-2" color="secondary">
              {projectName(schedule.projectId)} · {formatWeekdays(schedule.weekdays)} в {formatTime(schedule.hour, schedule.minute)} ({schedule.timezone}) · {modelLabel(schedule.model)}{executorLabel(schedule.executor) && ` · ${executorLabel(schedule.executor)}`}
            </Text>
            <Text variant="caption-2" color="secondary" ellipsis title={schedule.task}>
              {schedule.task}
            </Text>
            {schedule.lastRunAt && (
              <Text variant="caption-2" color="secondary">
                последний запуск {formatRelativeTime(schedule.lastRunAt)}
                {schedule.lastResult && ` · ${schedule.lastResult}`}
              </Text>
            )}
          </div>
          <div className={styles.rowActions}>
            {!schedule.enabled && <Label theme="normal">выключено</Label>}
            <Button view="flat-secondary" size="s" loading={runningId === schedule.id} aria-label={`Запустить сейчас: ${schedule.name}`} title="Запустить сейчас" onClick={() => void handleRunNow(schedule)}>
              <Icon data={Play} size={16} />
            </Button>
            <Button view="flat-secondary" size="s" aria-label={`Изменить: ${schedule.name}`} onClick={() => open(schedule)}>
              <Icon data={Pencil} size={16} />
            </Button>
            <Button view="flat-danger" size="s" aria-label={`Удалить: ${schedule.name}`} onClick={() => setConfirmDelete(schedule)}>
              <Icon data={TrashBin} size={16} />
            </Button>
          </div>
        </div>
      ))}

      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} maxWidth="s" aria-labelledby="lab-schedule-delete-title">
        <Dialog.Header caption="Удалить расписание" id="lab-schedule-delete-title" />
        <Dialog.Body>
          <Text variant="body-2">Удалить расписание «{confirmDelete?.name}»?</Text>
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Удалить"
          propsButtonApply={{ view: 'outlined-danger' }}
          onClickButtonCancel={() => setConfirmDelete(null)}
          onClickButtonApply={() => void handleDelete()}
        />
      </Dialog>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} maxWidth="s" aria-labelledby="lab-schedule-title">
        <Dialog.Header caption={editing?.id ? 'Изменить расписание' : 'Новое расписание'} id="lab-schedule-title" />
        <Dialog.Body>
          {editing && (
            <div className={styles.form}>
              <TextInput label="Название" value={editing.form.name} onUpdate={(name) => update({ name })} />
              <Select
                label="Проект"
                value={[editing.form.projectId]}
                onUpdate={([projectId]) => update({ projectId: projectId ?? '' })}
                options={(projects ?? []).map((project) => ({ value: String(project.id), content: `${project.name} (${project.repo})` }))}
                width="max"
              />
              <Text variant="body-2">Задача</Text>
              <TextArea
                controlProps={{ 'aria-label': 'Задача' }}
                placeholder="Что сделать в репозитории — своими словами, например: обновить зависимости с патч-версиями и починить сломавшиеся тесты"
                minRows={4}
                maxRows={12}
                value={editing.form.task}
                onUpdate={(task) => update({ task })}
              />
              <TextInput label="Время" value={editing.form.time} onUpdate={(time) => update({ time })} controlProps={{ type: 'time', 'aria-label': 'Время запуска' }} />
              <Text variant="body-2">Дни недели</Text>
              <div role="group" aria-label="Дни недели" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {WEEKDAYS.map(({ day, short }) => (
                  <Button key={day} size="s" view={editing.form.weekdays.includes(day) ? 'action' : 'outlined'} selected={editing.form.weekdays.includes(day)} onClick={() => toggleWeekday(day)}>
                    {short}
                  </Button>
                ))}
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
              <Select label="Где выполнять" value={[editing.form.executor]} onUpdate={([executor]) => update({ executor: (executor as LabExecutor) ?? 'any' })} options={EXECUTOR_OPTIONS} width="max" />
              {editing.form.executor === 'fusion' && (
                <Text variant="caption-2" color="secondary">
                  {EXECUTOR_HINT}
                </Text>
              )}
              <Select
                label="Контекст"
                value={[editing.form.contextId]}
                onUpdate={([contextId]) => update({ contextId: contextId ?? '' })}
                options={[{ value: '', content: 'Без контекста' }, ...(Array.isArray(contexts) ? contexts : []).map((context) => ({ value: String(context.id), content: context.name }))]}
                width="max"
              />
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
