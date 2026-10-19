import { describe, expect, it } from 'vitest';

import type { WorkerJob } from '../../store/api';
import { describeStage } from './jobStage';

const NOW = new Date('2026-10-19T12:00:00Z').getTime();
const job = (patch: Partial<WorkerJob>): WorkerJob =>
  ({
    id: 1,
    status: 'queued',
    createdAt: '2026-10-19T11:58:00Z',
    targetWorkerId: null,
    workerName: null,
    notBefore: null,
    cancelRequestedAt: null,
    ...patch,
  }) as WorkerJob;

describe('describeStage', () => {
  it('says how long a queued job has waited, and for whom', () => {
    expect(describeStage(job({}), NOW)).toBe('Ждёт свободный worker · 2 мин 00 с');
    expect(describeStage(job({ targetWorkerId: 3 }), NOW)).toMatch(/закреплена/);
  });

  it('says when a postponed job starts', () => {
    expect(describeStage(job({ notBefore: '2026-10-19T13:00:00Z' }), NOW)).toMatch(/^Запуск не раньше /);
  });

  it('names the worker of a claimed or running job', () => {
    expect(describeStage(job({ status: 'claimed', workerName: 'pi-blue' }), NOW)).toBe('Worker pi-blue взял задачу и готовит запуск');
    expect(describeStage(job({ status: 'running', workerName: 'pi-blue' }), NOW)).toBe('Выполняется на pi-blue');
  });

  it('says a stop was asked for', () => {
    expect(describeStage(job({ status: 'running', cancelRequestedAt: '2026-10-19T11:59:00Z' }), NOW)).toMatch(/Остановка запрошена/);
  });

  it('has nothing to say about a finished job', () => {
    expect(describeStage(job({ status: 'succeeded' }), NOW)).toBeNull();
  });
});
