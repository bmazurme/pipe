import type { AnalysisCategory, AnalysisItem, ImproveRun, ImproveRunStatus, ImproveSchedule, ImproveScheduleInput } from '../../store/api';
import { MODEL_OPTIONS } from '../worker/constants';
import { ALL_WEEKDAYS, formatWeekdays } from '../lab/weekdays';

export const RUN_STATUS_LABEL: Record<ImproveRunStatus, string> = {
  preparing: 'Готовится',
  queued: 'В очереди',
  running: 'Выполняется',
  publishing: 'Открываем PR',
  pr_open: 'PR открыт',
  pr_updated: 'PR исправлен',
  issue_open: 'Issue открыт',
  analyzed: 'Анализ готов',
  no_changes: 'Без изменений',
  failed: 'Ошибка',
  cancelled: 'Остановлена',
};

export const RUN_STATUS_THEME: Record<ImproveRunStatus, 'normal' | 'info' | 'success' | 'danger' | 'warning'> = {
  preparing: 'info',
  queued: 'normal',
  running: 'info',
  publishing: 'info',
  pr_open: 'success',
  pr_updated: 'success',
  issue_open: 'success',
  analyzed: 'success',
  no_changes: 'warning',
  failed: 'danger',
  cancelled: 'warning',
};

// Runs list polling: fast while something is working, slow otherwise.
export const FAST_POLL_MS = 5000;
export const SLOW_POLL_MS = 30000;

export const ACTIVE_RUN_STATUSES: ImproveRunStatus[] = ['preparing', 'queued', 'running', 'publishing'];

export const isActiveRun = (run: Pick<ImproveRun, 'status'> | null | undefined): boolean =>
  Boolean(run) && ACTIVE_RUN_STATUSES.includes((run as ImproveRun).status);

// A run blocks starting another for the same issue while it is working or its PR is open
// (a CI repair that pushed its fix to the PR leaves the PR open too).
export const blocksNewRun = (run: Pick<ImproveRun, 'status'> | null | undefined): boolean =>
  isActiveRun(run) || run?.status === 'pr_open' || run?.status === 'pr_updated';

export const CATEGORY_LABEL: Record<AnalysisCategory, string> = {
  general: 'Общий анализ',
  uiux: 'UI/UX',
  security: 'Безопасность',
  performance: 'Производительность',
  reliability: 'Надёжность',
  tests: 'Тесты',
  docs: 'Документация',
  architecture: 'Архитектура',
  refactoring: 'Рефакторинг',
  features: 'Новые фичи',
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_LABEL) as AnalysisCategory[];

/** Ticked by default (and what an analysis without a choice covers): the improvement directions. New features and refactoring are opt-in. */
const OPT_IN_CATEGORIES: AnalysisCategory[] = ['refactoring', 'features'];
export const DEFAULT_CATEGORIES: AnalysisCategory[] = ALL_CATEGORIES.filter((category) => !OPT_IN_CATEGORIES.includes(category));

/** The proposals stored on an analysis run, or [] when there are none yet. */
export function analysisItems(run: Pick<ImproveRun, 'result'>): AnalysisItem[] {
  try {
    const parsed = JSON.parse(run.result ?? '{}') as { items?: AnalysisItem[] };

    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export const modelLabel = (model: string): string => {
  const custom = /^custom:(\d+)$/.exec(model);

  return MODEL_OPTIONS.find((option) => option.value === model)?.content ?? (custom ? `Своя модель (ключ #${custom[1]})` : model);
};

const MODEL_STORAGE_KEY = 'improve.model';

// Shared across every "Модель" picker on this page (Задачи, Анализ) — picking opus in one tab
// and finding sonnet still selected in another was the inconsistency this fixes.
export function readStoredModel(): string {
  try {
    const value = localStorage.getItem(MODEL_STORAGE_KEY);

    return MODEL_OPTIONS.some((option) => option.value === value) ? (value as string) : 'sonnet';
  } catch {
    return 'sonnet';
  }
}

export function storeModel(value: string): void {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, value);
  } catch {
    // Not remembering the choice is fine.
  }
}

const pad = (value: number) => String(value).padStart(2, '0');

export const formatTime = (hour: number, minute: number): string => `${pad(hour)}:${pad(minute)}`;

export function describeSchedule(
  schedule: Pick<ImproveSchedule, 'hour' | 'minute' | 'timezone' | 'count' | 'model'> & Partial<Pick<ImproveSchedule, 'kind' | 'categories' | 'weekdays'>>,
  // How a model is named; a page that knows the owner's custom keys passes its own (useModelOptions).
  label: (model: string) => string = modelLabel,
): string {
  if (schedule.kind === 'analysis') {
    const chosen = schedule.categories ? schedule.categories.split(',').filter((c): c is AnalysisCategory => c in CATEGORY_LABEL) : DEFAULT_CATEGORIES;
    const what = chosen.length === DEFAULT_CATEGORIES.length && !chosen.some((category) => OPT_IN_CATEGORIES.includes(category)) ? 'анализ: 5 направлений' : `анализ: ${chosen.map((c) => CATEGORY_LABEL[c]).join(', ')}`;

    return `${formatWeekdays(schedule.weekdays)} в ${formatTime(schedule.hour, schedule.minute)} (${schedule.timezone}) · ${what} · ${label(schedule.model)}`;
  }

  const count = schedule.count;
  const noun = count % 10 === 1 && count % 100 !== 11 ? 'задача' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? 'задачи' : 'задач';

  return `${formatWeekdays(schedule.weekdays)} в ${formatTime(schedule.hour, schedule.minute)} (${schedule.timezone}) · ${count} ${noun} · ${label(schedule.model)}`;
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
  kind?: 'issues' | 'analysis';
  categories?: AnalysisCategory[];
  autoCreateIssues?: boolean;
  autoStartIssues?: boolean;
  onlyOnNewCommits?: boolean;
  /** A saved Context id as the Select's string value; '' = none. Left out = untouched. */
  contextId?: string;
  /** ISO weekdays; left out = untouched (every day). */
  weekdays?: number[];
}

/** The API input, or the first problem to show the user. */
export function validateScheduleForm(form: ScheduleForm): ImproveScheduleInput | string {
  const time = parseTime(form.time);
  const count = Number(form.count);
  const weekdays = form.weekdays === undefined ? {} : { weekdays: form.weekdays.length === ALL_WEEKDAYS.length ? null : [...form.weekdays].sort((a, b) => a - b) };
  const context = form.contextId === undefined ? {} : { contextId: form.contextId ? Number(form.contextId) : null };

  if (!form.name.trim()) return 'Укажите название';
  if (!time) return 'Укажите время в формате ЧЧ:ММ';
  if (form.weekdays?.length === 0) return 'Выберите хотя бы один день недели';
  if (form.kind === 'analysis') {
    if (!form.categories?.length) return 'Выберите хотя бы одно направление';

    return {
      name: form.name.trim(),
      enabled: form.enabled,
      hour: time.hour,
      minute: time.minute,
      timezone: form.timezone,
      count: 5,
      model: form.model,
      kind: 'analysis',
      categories: form.categories,
      autoCreateIssues: form.autoCreateIssues ?? true,
      autoStartIssues: form.autoStartIssues ?? false,
      onlyOnNewCommits: form.onlyOnNewCommits ?? false,
      ...context,
      ...weekdays,
    };
  }
  if (!Number.isInteger(count) || count < 1 || count > 20) return 'Количество задач — от 1 до 20';

  return { name: form.name.trim(), enabled: form.enabled, hour: time.hour, minute: time.minute, timezone: form.timezone, count, model: form.model, ...context, ...weekdays };
}
