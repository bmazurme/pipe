// What a worker can do besides running a model. A job may require one: only a worker that has it takes the job.
//  - fusion: the worker runs on a computer with Autodesk Fusion 360 open and the pipe add-in installed (worker/fusion-addin), so a
//    run can build and check CAD models there.
export const WORKER_CAPABILITIES = ['fusion'] as const;

export type WorkerCapability = (typeof WORKER_CAPABILITIES)[number];

export const WORKER_CAPABILITY_LABEL: Record<WorkerCapability, string> = {
  fusion: 'Fusion 360',
};

export function isWorkerCapability(value: unknown): value is WorkerCapability {
  return WORKER_CAPABILITIES.includes(value as WorkerCapability);
}
