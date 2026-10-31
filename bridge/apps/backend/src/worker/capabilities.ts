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

// Where a worker's VPN tunnel comes from:
//  - link: the vless:// link pasted into the worker's own settings (what every worker did before; empty link = no VPN);
//  - connection: a specific connection of the VPN page (its link is built from the panel on demand);
//  - active: whichever connection is active on the VPN page, so switching it there switches this worker too.
export const WORKER_VPN_SOURCES = ['link', 'connection', 'active'] as const;

export type WorkerVpnSource = (typeof WORKER_VPN_SOURCES)[number];
