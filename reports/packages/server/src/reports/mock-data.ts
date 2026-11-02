import type { ReportType } from '@reports/shared';

export const mockReports: ReportType[] = [
  { name: '101 Доработка формы авторизации', status: 'Закрыта', time: 8, created: '20241001120000' },
  { name: '102 Исправление бага с экспортом отчётов', status: 'Закрыта', time: 4, created: '20241002120000' },
  { name: '103 Рефакторинг модуля синхронизации', status: 'В работе', time: 6, created: '20241003120000' },
  { name: '104 Добавление валидации формы', status: 'В работе', time: 2, created: '20241004120000' },
  { name: '105 Задача без затраченного времени', status: 'В работе', time: 0, created: '20241005120000' },
  { name: '106 Превышение нормы часов (тест)', status: 'В работе', time: 2, created: '20241006120000' },
];
