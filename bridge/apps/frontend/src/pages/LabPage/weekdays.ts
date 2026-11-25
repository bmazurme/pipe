// ISO weekdays (1 = Mon … 7 = Sun), as a Lab schedule stores them.
export const WEEKDAYS = [
  { day: 1, short: 'Пн' },
  { day: 2, short: 'Вт' },
  { day: 3, short: 'Ср' },
  { day: 4, short: 'Чт' },
  { day: 5, short: 'Пт' },
  { day: 6, short: 'Сб' },
  { day: 7, short: 'Вс' },
];

export const ALL_WEEKDAYS = WEEKDAYS.map(({ day }) => day);
export const WORKDAYS = WEEKDAYS.filter(({ day }) => day <= 5).map(({ day }) => day);
export const WEEKEND_DAYS = WEEKDAYS.filter(({ day }) => day > 5).map(({ day }) => day);

const shortOf = (day: number) => WEEKDAYS.find((weekday) => weekday.day === day)?.short ?? String(day);

// "каждый день", "Пн–Пт", "Пн, Ср, Пт", "Сб, Вс": three or more days in a row become a range.
export function formatWeekdays(weekdays: number[] | null | undefined): string {
  const days = [...new Set(weekdays ?? [])].sort((a, b) => a - b);

  if (days.length === 0 || days.length === ALL_WEEKDAYS.length) return 'каждый день';

  const runs: number[][] = [];

  for (const day of days) {
    const last = runs[runs.length - 1];

    if (last && last[last.length - 1] === day - 1) last.push(day);
    else runs.push([day]);
  }

  return runs.flatMap((run) => (run.length >= 3 ? [`${shortOf(run[0])}–${shortOf(run[run.length - 1])}`] : run.map(shortOf))).join(', ');
}
