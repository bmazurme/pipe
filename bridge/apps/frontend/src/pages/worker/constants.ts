import { ACTIVE_JOB_STATUSES, WorkerJob, WorkerJobModel, WorkerJobStatus } from '../../store/api';

export const JOB_POLL_INTERVAL_MS = 3000;
// With nothing queued or running there is nothing to watch move — a slow
// refresh is enough to notice a job created from another tab or device.
export const JOB_IDLE_POLL_INTERVAL_MS = 15000;
// Comfortably below the backend's own 30s staleness window
// (WorkerHeartbeatService's STALE_AFTER_MS) so an actually-down worker
// reads as "down" within one or two polls, not half a minute late.
export const WORKER_STATUS_POLL_INTERVAL_MS = 10000;

export const MODEL_OPTIONS: { value: WorkerJobModel; content: string }[] = [
  { value: 'sonnet', content: 'Claude Sonnet' },
  { value: 'opus', content: 'Claude Opus' },
  { value: 'gpt', content: 'GPT' },
  { value: 'deepseek', content: 'DeepSeek' },
  { value: 'qwen', content: 'Qwen' },
];

export const STATUS_LABEL: Record<WorkerJobStatus, string> = {
  queued: 'В очереди',
  claimed: 'Взята воркером',
  running: 'Выполняется',
  succeeded: 'Готово',
  failed: 'Ошибка',
};

export const STATUS_THEME: Record<WorkerJobStatus, 'normal' | 'info' | 'success' | 'danger'> = {
  queued: 'normal',
  claimed: 'info',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
};

export function isActive(status: WorkerJobStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(status);
}

type TaskState = 'idle' | 'running' | 'done' | 'error';

const TASK_STATE_LABEL: Record<TaskState, string> = {
  idle: 'Свободен',
  running: 'Выполняется задача',
  done: 'Выполнено',
  error: 'Ошибка',
};

const TASK_STATE_THEME: Record<TaskState, 'normal' | 'info' | 'success' | 'danger'> = {
  idle: 'normal',
  running: 'info',
  done: 'success',
  error: 'danger',
};

export { TASK_STATE_LABEL, TASK_STATE_THEME };
export type { TaskState };

// Jobs are already sorted newest-first (see WorkerService.findAllByUser),
// so the current "task slot" state is just the most recent job's status,
// collapsed into the four states the Worker page actually cares about —
// no separate tracking needed.
export function deriveTaskState(jobs: WorkerJob[]): TaskState {
  const latest = jobs[0];
  if (!latest) return 'idle';
  if (isActive(latest.status)) return 'running';
  if (latest.status === 'failed') return 'error';
  return 'done';
}
