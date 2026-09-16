export function countWorkAndShortDays(
  year: number = 2025,
  holidays: string[] = [],
  shortDays: string[] = [],
  badDays: string[] = [],
  offDays: string[] = [],
) { 
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new Error('Год должен быть целым числом от 1 до 9999');
  }
  // Инициализация данных по месяцам
  const data: any = {};
  const SUNDAY = 0;
  const SATURDAY = 6;

  const holidaySet = new Set(holidays);
  const shortDaySet = new Set(shortDays);
  const badDaySet = new Set(badDays);
  const offDaySet = new Set(offDays);

  for (let month = 1; month <= 12; month++) {
    data[month] = {
      allDays: 0,
      shortDays: 0,
      holidays: 0,
      weekends: 0,
      workDays: 0,
      hours: 0,
      offDays: 0,
    };
  }

  for (let month = 0; month < 12; month++) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(Date.UTC(year, month, day));
      const dayOfWeek = date.getUTCDay(); // 0 — воскресенье, 6 — суббота
      const dateStr: string = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const monthKey = month + 1;

      // Подсчёт всех дней
      data[monthKey].allDays++;

      // Подсчёт выходных
      if ((dayOfWeek === SUNDAY || dayOfWeek === SATURDAY)) {
        data[monthKey].weekends++;
      }

      // Подсчёт праздников
      if (dayOfWeek !== SUNDAY && dayOfWeek !== SATURDAY && holidaySet.has(dateStr)) {
        data[monthKey].holidays++;
      }

      // Подсчёт сокращённых дней
      if (shortDaySet.has(dateStr)) {
        data[monthKey].shortDays++;
      }

      if (badDaySet.has(dateStr)) {
        data[monthKey].weekends--;
      }

      // Считаем off-day только если он выпадает на рабочий день
      // (не выходной и не праздник), иначе он уже вычтен и вычитать повторно нельзя
      if (
        dayOfWeek !== SUNDAY &&
        dayOfWeek !== SATURDAY &&
        !holidaySet.has(dateStr) &&
        offDaySet.has(dateStr)
      ) {
        data[monthKey].offDays++;
      }
    }
  }

  // Расчёт рабочих дней: все дни минус выходные минус праздники
  // (учитываем, что праздники могут совпадать с выходными — тогда они уже учтены в weekends)
  Object.keys(data).forEach(month => {
    data[month].workDays = data[month].allDays - data[month].weekends - data[month].holidays - data[month].offDays;
    data[month].hours = data[month].workDays * 8 - data[month].shortDays;
  });

  return data;
}
