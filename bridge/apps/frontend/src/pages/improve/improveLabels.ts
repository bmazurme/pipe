import type { ImproveRun, ImproveRunStatus, ImproveSchedule, ImproveScheduleInput } from '../../store/api';
import { MODEL_OPTIONS } from '../worker/constants';

export const RUN_STATUS_LABEL: Record<ImproveRunStatus, string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  publishing: 'Открываем PR',
  pr_open: 'PR открыт',
  no_changes: 'Без изменений',
  failed: 'Ошибка',
  cancelled: 'Остановлена',
};

export const RUN_STATUS_THEME: Record<ImproveRunStatus, 'normal' | 'info' | 'success' | 'danger' | 'warning'> = {
  queued: 'normal',
  running: 'info',
  publishing: 'info',
  pr_open: 'success',
  no_changes: 'warning',
  failed: 'danger',
  cancelled: 'warning',
};

export const ACTIVE_RUN_STATUSES: ImproveRunStatus[] = ['queued', 'running', 'publishing'];

export const isActiveRun = (run: Pick<ImproveRun, 'status'> | null | undefined): boolean =>
  Boolean(run) && ACTIVE_RUN_STATUSES.includes((run as ImproveRun).status);

// A run blocks starting another for the same issue while it is working or its PR is open.
export const blocksNewRun = (run: Pick<ImproveRun, 'status'> | null | undefined): boolean =>
  isActiveRun(run) || run?.status === 'pr_open';

export const modelLabel = (model: string): string =>
  MODEL_OPTIONS.find((option) => option.value === model)?.content ?? model;

const pad = (value: number) => String(value).padStart(2, '0');

export const formatTime = (hour: number, minute: number): string => `${pad(hour)}:${pad(minute)}`;

export function describeSchedule(schedule: Pick<ImproveSchedule, 'hour' | 'minute' | 'timezone' | 'count' | 'model'>): string {
  const count = schedule.count;
  const noun = count % 10 === 1 && count % 100 !== 11 ? 'задача' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? 'задачи' : 'задач';

  return `каждый день в ${formatTime(schedule.hour, schedule.minute)} (${schedule.timezone}) · ${count} ${noun} · ${modelLabel(schedule.model)}`;
}

/** "HH:MM" from an <input type="time">, or null when it is not a valid time. */
export function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());

  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export interface ScheduleForm {
  name: string;
  enabled: boolean;
  time: string;
  timezone: string;
  count: string;
  model: string;
}

/** The API input, or the first problem to show the user. */
export function validateScheduleForm(form: ScheduleForm): ImproveScheduleInput | string {
  const time = parseTime(form.time);
  const count = Number(form.count);

  if (!form.name.trim()) return 'Укажите название';
  if (!time) return 'Укажите время в формате ЧЧ:ММ';
  if (!Number.isInteger(count) || count < 1 || count > 20) return 'Количество задач — от 1 до 20';

  return { name: form.name.trim(), enabled: form.enabled, hour: time.hour, minute: time.minute, timezone: form.timezone, count, model: form.model };
}
