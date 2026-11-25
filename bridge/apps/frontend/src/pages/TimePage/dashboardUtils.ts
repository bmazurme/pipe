import type { DayOff, TimeReportEntry } from '../../store/api';

const HOURS_PER_WORKDAY = 8;

/** The status the report uses for a finished task. */
export const CLOSED_STATUS = 'Закрыта';

export interface MonthStats {
  allDays: number;
  workDays: number;
  weekends: number;
  holidays: number;
  offDays: number;
  shortDays: number;
  /** The month's hours norm: 8 per working day, minus 1 per short day. */
  norm: number;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The month's calendar numbers — the same arithmetic as reports' dashboard, from this
 * account's day-offs. A "compensatory" day is a weekend swapped in as a working day, so
 * it is not counted as a weekend; a holiday or day off that falls on a weekend is
 * already non-working and is not counted a second time.
 */
export function monthStats(year: number, month: number, dayOffs: Pick<DayOff, 'date' | 'type'>[]): MonthStats {
  const types = new Map(dayOffs.map((dayOff) => [dayOff.date, dayOff.type]));
  const stats = { allDays: 0, weekends: 0, holidays: 0, offDays: 0, shortDays: 0 };
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const type = types.get(`${year}-${pad(month)}-${pad(day)}`);
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6) && type !== 'compensatory';

    stats.allDays += 1;

    if (isWeekend) stats.weekends += 1;
    if (!isWeekend && type === 'holiday') stats.holidays += 1;
    if (!isWeekend && type === 'off') stats.offDays += 1;
    if (!isWeekend && type === 'short') stats.shortDays += 1;
  }

  const workDays = stats.allDays - stats.weekends - stats.holidays - stats.offDays;

  return { ...stats, workDays, norm: workDays * HOURS_PER_WORKDAY - stats.shortDays };
}

export interface ReportSummary {
  totalHours: number;
  tasks: number;
  closed: number;
  inProgress: number;
}

export function summarizeReport(entries: Pick<TimeReportEntry, 'hours' | 'status'>[]): ReportSummary {
  const closed = entries.filter((entry) => entry.status === CLOSED_STATUS).length;

  return {
    totalHours: entries.reduce((sum, entry) => sum + entry.hours, 0),
    tasks: entries.length,
    closed,
    inProgress: entries.length - closed,
  };
}

/** Share of the norm that is booked, in percent (0 when there is no norm). */
export function normRatio(totalHours: number, norm: number): number {
  return norm > 0 ? (totalHours / norm) * 100 : 0;
}
