import type { ReportType } from '@reports/shared';

export const mockReports: ReportType[] = [
  { name: '101 Доработка формы авторизации', status: 'Закрыта', time: 8 },
  { name: '102 Исправление бага с экспортом отчётов', status: 'Закрыта', time: 4 },
  { name: '103 Рефакторинг модуля синхронизации', status: 'В работе', time: 6 },
  { name: '104 Добавление валидации формы', status: 'В работе', time: 2 },
  { name: '105 Задача без затраченного времени', status: 'В работе', time: 0 },
  { name: '106 Превышение нормы часов (тест)', status: 'В работе', time: 2 },
];
