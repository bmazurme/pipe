import type { WorkerJob } from '../../store/api';
import { formatDuration } from '../../shared/lib/formatDuration';
import { isActive, isStopping } from './constants';

// One line saying what the job is doing right now, for the dialog's summary — null once it is over.
export function describeStage(job: WorkerJob, now: number): string | null {
  if (!isActive(job.status)) return null;
  if (isStopping(job)) return 'Остановка запрошена — ждём подтверждения от worker';

  if (job.status === 'queued') {
    const notBefore = job.notBefore ? new Date(job.notBefore).getTime() : NaN;

    if (!Number.isNaN(notBefore) && notBefore > now) {
      return `Запуск не раньше ${new Date(notBefore).toLocaleString('ru-RU')}`;
    }

    const waited = formatDuration(now - new Date(job.createdAt).getTime());

    return job.targetWorkerId !== null
      ? `Ждёт worker, на который закреплена задача · ${waited}`
      : `Ждёт свободный worker · ${waited}`;
  }

  return job.status === 'claimed'
    ? `Worker${job.workerName ? ` ${job.workerName}` : ''} взял задачу и готовит запуск`
    : `Выполняется${job.workerName ? ` на ${job.workerName}` : ''}`;
}

// What takes the stage line's place once the job is over, so the summary keeps its height instead of shrinking by a line.
export function describeOutcome(status: WorkerJob['status']): string {
  switch (status) {
    case 'succeeded':
      return 'Готово — результат можно скачать';
    case 'failed':
      return 'Завершилась с ошибкой';
    case 'cancelled':
      return 'Остановлена';
    default:
      return '';
  }
}
