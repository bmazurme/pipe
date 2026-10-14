import { SetMetadata } from '@nestjs/common';

export const WORKER_KEY_ALLOWED = 'workerKeyAllowed';

// Marks a route (or controller) a worker's own key may call. Without it a `brw_` key is refused, so a stolen worker key
// can claim and report jobs — and nothing else.
export const WorkerKeyAllowed = () => SetMetadata(WORKER_KEY_ALLOWED, true);
