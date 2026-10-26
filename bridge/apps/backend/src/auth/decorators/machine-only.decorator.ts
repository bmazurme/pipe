import { SetMetadata } from '@nestjs/common';

export const MACHINE_ONLY = 'machineOnly';

// Marks a route that hands out stored secrets in clear text: a browser session (JWT) is refused, only a worker key
// (`brw_`) or a personal API key (`brk_`) may call it.
export const MachineOnly = () => SetMetadata(MACHINE_ONLY, true);
