import { WorkerCapability } from '../worker/capabilities';

// Where a Lab run is executed: on any suitable worker (the default), or only on one set up for Fusion 360 (a Mac with Fusion open
// and the pipe add-in). Chosen from a list, not ticked: the task itself stays free text.
export const LAB_EXECUTORS = ['any', 'fusion'] as const;

export type LabExecutor = (typeof LAB_EXECUTORS)[number];

export const LAB_EXECUTOR_LABEL: Record<LabExecutor, string> = {
  any: 'Любой worker',
  fusion: 'Fusion 360 на Mac',
};

// The capability a job of this executor requires of its worker, or null for any worker.
export function requiredCapabilityOf(
  executor: LabExecutor,
): WorkerCapability | null {
  return executor === 'fusion' ? 'fusion' : null;
}
