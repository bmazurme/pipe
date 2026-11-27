import { plural } from '../../shared/lib/plural';
import type { DashboardRestoreDrill } from '../../store/api';

export function daysAgo(iso: string, now: number = Date.now()): string {
  const days = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));

  if (days === 0) return 'сегодня';

  return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`;
}

export function drillFacts(drill: DashboardRestoreDrill): string[] {
  const last = drill.recent.find((run) => run.ok);
  const facts: string[] = [];

  if (drill.backupAgeHours !== null) facts.push(`копия была старше базы на ${drill.backupAgeHours} ч`);
  if (drill.restoreSeconds !== null) facts.push(`загрузилась за ${drill.restoreSeconds < 90 ? `${drill.restoreSeconds} с` : `${Math.round(drill.restoreSeconds / 60)} мин`}`);
  if (last?.tables != null && last.rows != null) facts.push(`${last.tables} таблиц, ${last.rows.toLocaleString('ru-RU')} строк`);

  return facts;
}
