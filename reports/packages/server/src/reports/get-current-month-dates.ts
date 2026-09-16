export function getCurrentMonthDates() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  // Первое число месяца (00:00:00)
  const startOfMonth = new Date(year, month, 1, 0, 0, 0);
  // Последнее число месяца (23:59:59)
  const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);

  return {
    start: startOfMonth.toISOString().split('T')[0], // YYYY-MM-DD
    end: endOfMonth.toISOString().split('T')[0]     // YYYY-MM-DD
  };
}
