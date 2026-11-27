import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

import { REQUIRE_STEP_UP, StepUpGuard } from './step-up.guard';

// Marks a dangerous action (DEVELOPMENT-PLAN.md S6): a secret revealed, a credential issued or deleted, a VPN server
// provisioned, a link switched, data deleted. The caller must present a fresh second-factor grant
// (`X-Step-Up` header, from POST /auth/2fa/verify) or gets `403 {code: 'STEP_UP_REQUIRED'}`.
// Put it AFTER the route's authentication guard, so the guard it adds sees `request.user`.
export const RequireStepUp = () =>
  applyDecorators(SetMetadata(REQUIRE_STEP_UP, true), UseGuards(StepUpGuard));
