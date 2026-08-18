const DAY_MS = 24 * 60 * 60 * 1000;

function isNextCalendarDay(date: string, nextDate: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getTime();
  const nextDay = new Date(`${nextDate}T00:00:00Z`).getTime();
  return nextDay - day === DAY_MS;
}

/**
 * Splits a date-ascending list into runs of consecutive calendar days, so
 * the UI can highlight a vacation/sick-leave period as one visual block
 * instead of unrelated single days that happen to be adjacent in the list.
 */
export function groupConsecutiveDayOffs<T extends { date: string }>(
  dayOffs: T[],
): T[][] {
  const groups: T[][] = [];

  for (const dayOff of dayOffs) {
    const currentGroup = groups[groups.length - 1];
    const lastInGroup = currentGroup?.[currentGroup.length - 1];

    if (lastInGroup && isNextCalendarDay(lastInGroup.date, dayOff.date)) {
      currentGroup.push(dayOff);
    } else {
      groups.push([dayOff]);
    }
  }

  return groups;
}
