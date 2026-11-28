import type { PrReview } from '../../store/api';

export const filesWord = (count: number) => {
  const last = count % 10;
  const tens = count % 100;

  if (tens >= 11 && tens <= 14) return 'файлов';
  if (last === 1) return 'файл';
  if (last >= 2 && last <= 4) return 'файла';

  return 'файлов';
};

export function runLine(run: NonNullable<PrReview['run']>): string {
  return [
    run.model + (run.tier !== null ? `, ярус ${run.tier}` : ''),
    run.workMinutes !== null ? `${run.workMinutes} мин` : null,
    run.costUsd !== null ? `$${run.costUsd.toFixed(2)}` : null,
    run.ciRepairs > 0 ? `ремонтов CI: ${run.ciRepairs}` : null,
    run.escalated ? 'после шага вверх' : null,
    run.trigger !== 'manual' ? `запуск: ${run.trigger}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
