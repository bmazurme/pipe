import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { StepUpService } from './step-up.service';

export const STEP_UP_HEADER = 'x-step-up';

export const REQUIRE_STEP_UP = 'requireStepUp';

interface RequestUser {
  id?: number;
  sessionId?: number;
}

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly stepUp: StepUpService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_STEP_UP,
      [context.getHandler(), context.getClass()],
    );

    if (!required) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: RequestUser }>();
    const user = request.user;

    if (user?.id === undefined) throw new ForbiddenException();

    // A machine caller (personal API key) has no browser session to confirm with; the routes it may share with the
    // browser (Storage delete) keep working for sync/reports, and the key itself is what S5 limits.
    if (user.sessionId === undefined) return true;

    const action = `${request.method} ${request.route?.path ?? request.path}`;

    if (!(await this.stepUp.isEnabled(user.id))) {
      if (this.stepUp.enforced()) {
        throw new ForbiddenException({
          code: 'STEP_UP_NOT_ENROLLED',
          message:
            'This action needs two-factor protection; turn it on in the profile first',
        });
      }

      this.stepUp.audit(
        'warn',
        'stepup.skipped',
        `${action} without a second factor (not set up)`,
        {
          userId: user.id,
        },
      );

      return true;
    }

    const header = request.headers[STEP_UP_HEADER];
    const token = typeof header === 'string' ? header : undefined;

    if (!token || !this.stepUp.checkGrant(token, user.id, user.sessionId)) {
      throw new ForbiddenException({
        code: 'STEP_UP_REQUIRED',
        message: 'Confirm with a code from the authenticator app',
      });
    }

    this.stepUp.audit('info', 'stepup.action', `${action} confirmed`, {
      userId: user.id,
    });

    return true;
  }
}
